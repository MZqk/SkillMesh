import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { CatalogService } from "./lib/catalog-service.mjs";
import { EcosystemCatalogService } from "./lib/ecosystem-catalog.mjs";
import { planToMarkdown } from "./lib/exporter.mjs";
import { InstallationManager } from "./lib/installation-manager.mjs";
import { buildPlan } from "./lib/matcher.mjs";
import { buildSkillKit, reconcileSkillKit } from "./lib/skill-kit.mjs";
import {
  WorkflowConflictError,
  WorkflowNotFoundError,
  WorkflowStore,
} from "./lib/workflow-store.mjs";

const PUBLIC_DIR = path.resolve(import.meta.dirname, "public");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, data) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function readJson(request, { maxBytes = 1_000_000 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("request-too-large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(url, response) {
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    sendJson(response, 403, { error: "forbidden" });
    return;
  }
  try {
    const contents = await fs.readFile(filePath);
    response.writeHead(200, {
      "content-type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "content-length": contents.length,
      "cache-control": "no-cache",
    });
    response.end(contents);
  } catch (error) {
    if (error.code === "ENOENT") sendJson(response, 404, { error: "not-found" });
    else throw error;
  }
}

function webActor() {
  return { type: "human", name: "local-user", channel: "web" };
}

// 服务端代理到 OpenAI（Codex / 任意聊天模型）。API key 只在服务端读取，绝不下发到浏览器。
async function runAgentTask({ task, context }) {
  const apiKey = process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error("agent-api-key-missing");
    error.status = 400;
    throw error;
  }
  const model = process.env.CODEX_MODEL || "codex-mini-latest";
  const systemPrompt = [
    "你是 Capability Atlas 的本地 AI 助手。Capability Atlas 是一个把功能需求映射到本机 Agent Skill 的能力测绘工具。",
    context
      ? `以下是当前工作流的上下文（JSON 摘要），用于回答或处理用户任务：\n${context}`
      : "没有附加工作流上下文。",
    "用简体中文回答。若任务涉及创建或修改工作流 / Brief / Playbook，只给出结构化建议，不要声称已写入系统——这些动作只能在网页由用户确认。",
  ].join("\n\n");
  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: task },
      ],
      temperature: 0.2,
    }),
  });
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    const error = new Error(`agent-upstream-error:${upstream.status}`);
    error.status = 502;
    error.detail = detail;
    throw error;
  }
  const data = await upstream.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

function workflowRoute(pathname) {
  const match = pathname.match(/^\/api\/workflows\/([^/]+)(?:\/(assess|review|validate|confirm|history|export|external-candidates))?$/);
  if (!match) return null;
  return { id: decodeURIComponent(match[1]), action: match[2] || null };
}

function workflowVersionRoute(pathname) {
  const match = pathname.match(/^\/api\/workflows\/([^/]+)\/history\/(\d+)$/);
  return match ? { id: decodeURIComponent(match[1]), version: Number(match[2]) } : null;
}

function projectBriefRoute(pathname) {
  const match = pathname.match(/^\/api\/workflows\/([^/]+)\/brief(?:\/(freeze|history))?$/);
  if (!match) return null;
  return { id: decodeURIComponent(match[1]), action: match[2] || null };
}

function projectBriefVersionRoute(pathname) {
  const match = pathname.match(/^\/api\/workflows\/([^/]+)\/brief\/history\/(\d+)$/);
  return match ? { id: decodeURIComponent(match[1]), version: Number(match[2]) } : null;
}

function playbookRoute(pathname) {
  const match = pathname.match(/^\/api\/workflows\/([^/]+)\/playbook(?:\/(generate|confirm|history|export|diff|verification|template-status|template-preview|template-migrate))?$/);
  if (!match) return null;
  return { id: decodeURIComponent(match[1]), action: match[2] || null };
}

function playbookVersionRoute(pathname) {
  const match = pathname.match(/^\/api\/workflows\/([^/]+)\/playbook\/history\/(\d+)$/);
  return match ? { id: decodeURIComponent(match[1]), version: Number(match[2]) } : null;
}

function playbookProgressRoute(pathname) {
  const match = pathname.match(/^\/api\/workflows\/([^/]+)\/playbook\/progress(?:\/(start|steps|gates))?$/);
  if (!match) return null;
  return { id: decodeURIComponent(match[1]), action: match[2] || null };
}

function installationPlanRoute(pathname) {
  const match = pathname.match(/^\/api\/workflows\/([^/]+)\/install-plans(?:\/([^/]+)(?:\/(execute|acknowledge))?)?$/);
  if (!match) return null;
  return {
    id: decodeURIComponent(match[1]),
    planId: match[2] ? decodeURIComponent(match[2]) : null,
    action: match[3] || null,
  };
}

function skillKitRoute(pathname) {
  const match = pathname.match(/^\/api\/workflows\/([^/]+)\/skill-kit(?:\/(preview))?$/);
  if (!match) return null;
  return { id: decodeURIComponent(match[1]), action: match[2] || null };
}

function installationItemRoute(pathname) {
  const match = pathname.match(/^\/api\/workflows\/([^/]+)\/install-plans\/([^/]+)\/items\/([^/]+)\/quarantine$/);
  if (!match) return null;
  return {
    id: decodeURIComponent(match[1]),
    planId: decodeURIComponent(match[2]),
    itemId: decodeURIComponent(match[3]),
  };
}

function installationJobRoute(pathname) {
  const match = pathname.match(/^\/api\/installations\/jobs\/([^/]+)\/cancel$/);
  return match ? { jobId: decodeURIComponent(match[1]) } : null;
}

function ecosystemGroupRoute(pathname) {
  const match = pathname.match(/^\/api\/ecosystem\/groups\/([^/]+)$/);
  return match ? { groupId: decodeURIComponent(match[1]) } : null;
}

function ecosystemSkillDocumentRoute(pathname) {
  const match = pathname.match(/^\/api\/ecosystem\/items\/([^/]+)\/skills\/([^/]+)\/document$/);
  return match ? {
    itemId: decodeURIComponent(match[1]),
    skillName: decodeURIComponent(match[2]),
  } : null;
}

export function createServer(options = {}) {
  const store = options.store || options.service?.store || new WorkflowStore();
  const service = options.service || new CatalogService({
    store,
    homeDirectory: options.homeDirectory,
    projectRoot: options.projectRoot,
    pdfRenderer: options.pdfRenderer,
  });
  const installations = options.installations || new InstallationManager({
    store,
    service,
    homeDirectory: options.homeDirectory,
    dataDirectory: options.dataDirectory || path.dirname(store.filePath),
    runner: options.installationRunner,
    securityScanner: options.securityScanner,
  });
  const ecosystemCatalog = options.ecosystemCatalog || new EcosystemCatalogService({
    fetcher: options.ecosystemFetch,
    sourceUrl: options.ecosystemSourceUrl,
    githubToken: options.githubToken ?? process.env.CAPABILITY_ATLAS_GITHUB_TOKEN,
  });
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, {
          app: "capability-atlas",
          ok: true,
          readOnly: false,
          skillFilesystem: "human-approved-managed-writes",
          installationExecution: "web-only",
          workflowPersistence: true,
          mcpTransport: "stdio",
          version: "0.6.0",
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/installations/status") {
        sendJson(response, 200, await installations.status());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/installations/repair") {
        const body = await readJson(request);
        sendJson(response, 200, await installations.resolveRepair(body, webActor()));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/scan") {
        sendJson(response, 200, await service.publicInventory({ refresh: url.searchParams.get("refresh") === "1" }));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/ecosystem/catalog") {
        sendJson(response, 200, await ecosystemCatalog.search({
          query: url.searchParams.get("query") || "",
          category: url.searchParams.get("category") || "",
          source: url.searchParams.get("source") || "",
          chain: url.searchParams.get("chain") || "",
          sort: url.searchParams.get("sort") || "relevance",
          cursor: url.searchParams.get("cursor") || 0,
          limit: url.searchParams.get("limit") || 100,
          refresh: url.searchParams.get("refresh") === "1",
        }));
        return;
      }
      const ecosystemGroupRequest = ecosystemGroupRoute(url.pathname);
      if (ecosystemGroupRequest && request.method === "GET") {
        sendJson(response, 200, await ecosystemCatalog.comparisonForGroup(ecosystemGroupRequest.groupId));
        return;
      }
      const ecosystemDocumentRequest = ecosystemSkillDocumentRoute(url.pathname);
      if (ecosystemDocumentRequest && request.method === "GET") {
        sendJson(response, 200, await ecosystemCatalog.previewForSkill({
          ...ecosystemDocumentRequest,
          refresh: url.searchParams.get("refresh") === "1",
        }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/scan") {
        const body = await readJson(request);
        sendJson(response, 200, await service.publicInventory({
          refresh: body.refresh === true,
          customRootPaths: body.customRoots || [],
        }));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/settings") {
        sendJson(response, 200, await store.getSettings());
        return;
      }
      if (request.method === "PUT" && url.pathname === "/api/settings") {
        const body = await readJson(request);
        service.resolvedRoots(body.customRoots || []);
        sendJson(response, 200, await store.updateSettings({ customRoots: body.customRoots || [] }, webActor()));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/workspace/export") {
        sendJson(response, 200, {
          kind: "capability-atlas-shared-workspace",
          exportedAt: new Date().toISOString(),
          appVersion: "0.6.0",
          data: await store.exportData(),
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/workspace/import") {
        const body = await readJson(request, { maxBytes: 20_000_000 });
        const source = body.data || body;
        service.resolvedRoots(source?.settings?.customRoots || []);
        sendJson(response, 200, await store.importData(body, webActor()));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/workflows") {
        sendJson(response, 200, await store.listWorkflows({
          cursor: url.searchParams.get("cursor"),
          limit: url.searchParams.get("limit"),
          scope: url.searchParams.get("scope"),
          projectId: url.searchParams.get("projectId"),
          status: url.searchParams.get("status"),
        }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/workflows") {
        const body = await readJson(request);
        const workflow = body.useReferenceTemplate === false
          ? await store.createWorkflow(body, webActor())
          : await service.createReferenceDraft(body, webActor());
        sendJson(response, 201, workflow);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/agent/task") {
        const body = await readJson(request, { maxBytes: 200_000 });
        if (typeof body.task !== "string" || !body.task.trim()) {
          sendJson(response, 400, { error: "invalid-request", message: "task-required" });
          return;
        }
        let context;
        if (body.workflowId) {
          try {
            const wf = await store.getWorkflow(body.workflowId, { includeHistory: false });
            context = JSON.stringify({
              id: wf.id,
              name: wf.name,
              goal: wf.goal,
              stages: (wf.stages || []).map((stage) => ({
                title: stage.title,
                capabilities: (stage.capabilities || []).map((capability) => capability.label),
              })),
            });
          } catch {
            context = undefined;
          }
        }
        const result = await runAgentTask({ task: body.task, context });
        sendJson(response, 200, { result });
        return;
      }
      const workflowRequest = workflowRoute(url.pathname);
      const workflowVersionRequest = workflowVersionRoute(url.pathname);
      const projectBriefRequest = projectBriefRoute(url.pathname);
      const projectBriefVersionRequest = projectBriefVersionRoute(url.pathname);
      const playbookRequest = playbookRoute(url.pathname);
      const playbookVersionRequest = playbookVersionRoute(url.pathname);
      const playbookProgressRequest = playbookProgressRoute(url.pathname);
      const installPlanRequest = installationPlanRoute(url.pathname);
      const skillKitRequest = skillKitRoute(url.pathname);
      const installItemRequest = installationItemRoute(url.pathname);
      const installJobRequest = installationJobRoute(url.pathname);
      if (skillKitRequest && request.method === "GET" && !skillKitRequest.action) {
        const workflow = await store.getWorkflow(skillKitRequest.id);
        const requestedPlanId = url.searchParams.get("planId") || "";
        const plan = requestedPlanId
          ? (workflow.installationPlans || []).find((item) => item.id === requestedPlanId)
          : workflow.installationPlans?.at(-1);
        if (!plan) throw new Error("skill-kit-plan-not-found");
        const body = `${JSON.stringify(buildSkillKit({ workflow, plan }), null, 2)}\n`;
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(body),
          "content-disposition": "attachment; filename=\"capability-atlas.skill-kit.json\"",
          "cache-control": "no-store",
        });
        response.end(body);
        return;
      }
      if (skillKitRequest && request.method === "POST" && skillKitRequest.action === "preview") {
        const body = await readJson(request, { maxBytes: 600_000 });
        const [workflow, inventory] = await Promise.all([
          store.getWorkflow(skillKitRequest.id),
          service.publicInventory({ refresh: false }),
        ]);
        sendJson(response, 200, reconcileSkillKit({ kit: body.kit, inventory, workflow }));
        return;
      }
      if (installJobRequest && request.method === "POST") {
        sendJson(response, 202, await installations.cancel(installJobRequest, webActor()));
        return;
      }
      if (installItemRequest && request.method === "POST") {
        const body = await readJson(request);
        sendJson(response, 200, await installations.quarantineItem({
          workflowId: installItemRequest.id,
          planId: installItemRequest.planId,
          itemId: installItemRequest.itemId,
          expectedRevision: body.expectedRevision,
        }, webActor()));
        return;
      }
      if (installPlanRequest && request.method === "POST" && !installPlanRequest.planId) {
        const body = await readJson(request);
        sendJson(response, 201, await installations.createPlan({
          workflowId: installPlanRequest.id,
          expectedRevision: body.expectedRevision,
          targetAgents: body.targetAgents,
        }, webActor()));
        return;
      }
      if (installPlanRequest && request.method === "PATCH" && installPlanRequest.planId && !installPlanRequest.action) {
        const body = await readJson(request);
        sendJson(response, 200, await installations.configurePlan({
          workflowId: installPlanRequest.id,
          planId: installPlanRequest.planId,
          expectedRevision: body.expectedRevision,
          selectedItemIds: body.selectedItemIds,
          itemOptions: body.itemOptions,
        }, webActor()));
        return;
      }
      if (installPlanRequest && request.method === "POST" && installPlanRequest.action === "execute") {
        const body = await readJson(request);
        sendJson(response, 202, await installations.executePlan({
          workflowId: installPlanRequest.id,
          planId: installPlanRequest.planId,
          expectedRevision: body.expectedRevision,
        }, webActor()));
        return;
      }
      if (installPlanRequest && request.method === "POST" && installPlanRequest.action === "acknowledge") {
        const body = await readJson(request);
        sendJson(response, 200, await installations.acknowledgeWarnings({
          workflowId: installPlanRequest.id,
          planId: installPlanRequest.planId,
          expectedRevision: body.expectedRevision,
          itemIds: body.itemIds,
        }, webActor()));
        return;
      }
      if (workflowVersionRequest && request.method === "GET") {
        sendJson(response, 200, await store.getConfirmation(workflowVersionRequest.id, workflowVersionRequest.version));
        return;
      }
      if (projectBriefVersionRequest && request.method === "GET") {
        sendJson(response, 200, await store.getProjectBriefVersion(projectBriefVersionRequest.id, projectBriefVersionRequest.version));
        return;
      }
      if (projectBriefRequest && request.method === "GET" && !projectBriefRequest.action) {
        sendJson(response, 200, await store.getProjectBrief(projectBriefRequest.id, { includeHistory: true }));
        return;
      }
      if (projectBriefRequest && request.method === "POST" && !projectBriefRequest.action) {
        const body = await readJson(request);
        sendJson(response, 201, await service.createProjectBriefDraft(projectBriefRequest.id, body, webActor()));
        return;
      }
      if (projectBriefRequest && request.method === "PATCH" && !projectBriefRequest.action) {
        const body = await readJson(request);
        sendJson(response, 200, await store.updateProjectBrief(projectBriefRequest.id, {
          expectedRevision: body.expectedRevision,
          patch: body.patch,
        }, webActor()));
        return;
      }
      if (projectBriefRequest && request.method === "POST" && projectBriefRequest.action === "freeze") {
        const body = await readJson(request);
        sendJson(response, 200, await store.freezeProjectBrief(projectBriefRequest.id, body, webActor()));
        return;
      }
      if (projectBriefRequest && request.method === "GET" && projectBriefRequest.action === "history") {
        const brief = await store.getProjectBrief(projectBriefRequest.id, { includeHistory: true });
        sendJson(response, 200, { workflowId: projectBriefRequest.id, items: brief.history || [] });
        return;
      }
      if (playbookVersionRequest && request.method === "GET") {
        sendJson(response, 200, await store.getPlaybookVersion(playbookVersionRequest.id, playbookVersionRequest.version));
        return;
      }
      if (playbookProgressRequest && request.method === "GET" && !playbookProgressRequest.action) {
        sendJson(response, 200, await store.getPlaybookProgress(playbookProgressRequest.id));
        return;
      }
      if (playbookProgressRequest && request.method === "POST" && playbookProgressRequest.action === "start") {
        sendJson(response, 201, await store.startPlaybookProgress(playbookProgressRequest.id, webActor()));
        return;
      }
      if (playbookProgressRequest && request.method === "PATCH" && playbookProgressRequest.action === "steps") {
        const body = await readJson(request);
        sendJson(response, 200, await store.updatePlaybookStepProgress(playbookProgressRequest.id, body, webActor()));
        return;
      }
      if (playbookProgressRequest && request.method === "PATCH" && playbookProgressRequest.action === "gates") {
        const body = await readJson(request);
        sendJson(response, 200, await store.setPlaybookGateProgress(playbookProgressRequest.id, body, webActor()));
        return;
      }
      if (playbookRequest && request.method === "GET" && !playbookRequest.action) {
        sendJson(response, 200, await store.getPlaybook(playbookRequest.id, { includeHistory: true }));
        return;
      }
      if (playbookRequest && request.method === "GET" && playbookRequest.action === "diff") {
        sendJson(response, 200, await store.getPlaybookDiff(playbookRequest.id));
        return;
      }
      if (playbookRequest && request.method === "GET" && playbookRequest.action === "verification") {
        sendJson(response, 200, await store.getPlaybookVerification(playbookRequest.id));
        return;
      }
      if (playbookRequest && request.method === "POST" && playbookRequest.action === "verification") {
        sendJson(response, 201, await store.verifyPlaybook(playbookRequest.id, await readJson(request), webActor()));
        return;
      }
      if (playbookRequest && request.method === "GET" && playbookRequest.action === "template-status") {
        sendJson(response, 200, await service.playbookTemplateStatus(playbookRequest.id));
        return;
      }
      if (playbookRequest && request.method === "GET" && playbookRequest.action === "template-preview") {
        sendJson(response, 200, await service.previewPlaybookTemplateMigration(playbookRequest.id));
        return;
      }
      if (playbookRequest && request.method === "POST" && playbookRequest.action === "template-migrate") {
        sendJson(response, 201, await service.migratePlaybookTemplateDraft(
          playbookRequest.id,
          await readJson(request),
          webActor(),
        ));
        return;
      }
      if (playbookRequest && request.method === "PATCH" && !playbookRequest.action) {
        const body = await readJson(request);
        sendJson(response, 200, await store.updatePlaybook(playbookRequest.id, {
          expectedRevision: body.expectedRevision,
          patch: body.patch,
        }, webActor()));
        return;
      }
      if (playbookRequest && request.method === "POST" && playbookRequest.action === "generate") {
        const body = await readJson(request);
        sendJson(response, 201, await service.generatePlaybookDraft(playbookRequest.id, body, webActor()));
        return;
      }
      if (playbookRequest && request.method === "POST" && playbookRequest.action === "confirm") {
        const body = await readJson(request);
        sendJson(response, 200, await store.confirmPlaybook(playbookRequest.id, body, webActor()));
        return;
      }
      if (playbookRequest && request.method === "GET" && playbookRequest.action === "history") {
        const playbook = await store.getPlaybook(playbookRequest.id, { includeHistory: true });
        sendJson(response, 200, { workflowId: playbookRequest.id, items: playbook.history || [] });
        return;
      }
      if (playbookRequest && request.method === "GET" && playbookRequest.action === "export") {
        const requestedFormat = url.searchParams.get("format");
        const format = requestedFormat === "markdown" || requestedFormat === "pdf" ? requestedFormat : "json";
        const exported = await service.exportPlaybook(playbookRequest.id, { format });
        if (format === "markdown") {
          response.writeHead(200, {
            "content-type": "text/markdown; charset=utf-8",
            "content-disposition": 'attachment; filename="development-playbook.md"',
            "content-length": Buffer.byteLength(exported),
          });
          response.end(exported);
        } else if (format === "pdf") {
          response.writeHead(200, {
            "content-type": "application/pdf",
            "content-disposition": 'attachment; filename="development-playbook.pdf"',
            "content-length": exported.length,
            "cache-control": "no-store",
          });
          response.end(exported);
        } else sendJson(response, 200, exported);
        return;
      }
      if (workflowRequest && request.method === "GET" && !workflowRequest.action) {
        sendJson(response, 200, await store.getWorkflow(workflowRequest.id, { includeHistory: true }));
        return;
      }
      if (workflowRequest && request.method === "PATCH" && !workflowRequest.action) {
        const body = await readJson(request);
        sendJson(response, 200, await store.updateWorkflow(workflowRequest.id, {
          expectedRevision: body.expectedRevision,
          patch: body.patch,
        }, webActor()));
        return;
      }
      if (workflowRequest && request.method === "POST" && workflowRequest.action === "assess") {
        const body = await readJson(request);
        sendJson(response, 200, await service.assessWorkflow(workflowRequest.id, { refresh: body.refresh === true }));
        return;
      }
      if (workflowRequest && request.method === "POST" && workflowRequest.action === "review") {
        const body = await readJson(request);
        if (body.decision !== "unreviewed") await service.getSkill(body.contentHash);
        sendJson(response, 200, await store.setHumanReview(workflowRequest.id, body, webActor()));
        return;
      }
      if (workflowRequest && request.method === "POST" && workflowRequest.action === "external-candidates") {
        const body = await readJson(request);
        const workflow = await store.getWorkflow(workflowRequest.id);
        const stage = workflow.stages.find((item) => item.id === body.stageId);
        if (!stage) throw new Error("workflow-stage-not-found");
        if (!stage.capabilities.some((capability) => capability.id === body.capabilityId)) {
          throw new Error("workflow-capability-not-found");
        }
        const candidateInput = {
          itemId: body.catalogItemId,
          stageId: body.stageId,
          capabilityId: body.capabilityId,
          query: body.query,
          rationale: body.rationale,
        };
        const candidates = Array.isArray(body.skillNames)
          ? await ecosystemCatalog.candidatesForChain({ ...candidateInput, skillNames: body.skillNames })
          : [await ecosystemCatalog.candidateFor({ ...candidateInput, skillName: body.skillName })];
        sendJson(response, 201, await store.addExternalCandidates(workflowRequest.id, {
          expectedRevision: body.expectedRevision,
          candidates,
        }, webActor()));
        return;
      }
      if (workflowRequest && request.method === "POST" && workflowRequest.action === "validate") {
        const body = await readJson(request);
        await service.getSkill(body.contentHash);
        sendJson(response, 200, await store.setHumanValidation(workflowRequest.id, body, webActor()));
        return;
      }
      if (workflowRequest && request.method === "POST" && workflowRequest.action === "confirm") {
        const body = await readJson(request);
        const assessmentSnapshot = await service.confirmationAssessment(workflowRequest.id);
        sendJson(response, 200, await store.confirmWorkflow(workflowRequest.id, {
          ...body,
          assessmentSnapshot,
        }, webActor()));
        return;
      }
      if (workflowRequest && request.method === "GET" && workflowRequest.action === "history") {
        const workflow = await store.getWorkflow(workflowRequest.id, { includeHistory: true });
        sendJson(response, 200, { workflowId: workflow.id, items: workflow.history || [] });
        return;
      }
      if (workflowRequest && request.method === "GET" && workflowRequest.action === "export") {
        const format = url.searchParams.get("format") === "markdown" ? "markdown" : "json";
        const exported = await service.exportWorkflow(workflowRequest.id, { format, includePaths: true });
        if (format === "markdown") {
          response.writeHead(200, {
            "content-type": "text/markdown; charset=utf-8",
            "content-disposition": 'attachment; filename="capability-workflow.md"',
            "content-length": Buffer.byteLength(exported),
          });
          response.end(exported);
        } else sendJson(response, 200, exported);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/plan") {
        const body = await readJson(request);
        if (body.workflowId) {
          sendJson(response, 200, await service.assessWorkflow(body.workflowId, { refresh: body.refresh === true }));
          return;
        }
        const result = await buildPlan({
          goal: body.goal,
          overrides: body.overrides || {},
          inventory: await service.inventory({ customRootPaths: body.customRoots || [] }),
        });
        sendJson(response, 200, result);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/export") {
        const body = await readJson(request);
        if (body.workflowId) {
          const format = body.format === "markdown" ? "markdown" : "json";
          const exported = await service.exportWorkflow(body.workflowId, { format, includePaths: true });
          if (format === "markdown") {
            response.writeHead(200, {
              "content-type": "text/markdown; charset=utf-8",
              "content-disposition": 'attachment; filename="capability-workflow.md"',
              "content-length": Buffer.byteLength(exported),
            });
            response.end(exported);
          } else sendJson(response, 200, exported);
          return;
        }
        const plan = await buildPlan({
          goal: body.goal,
          overrides: body.overrides || {},
          inventory: await service.inventory({ customRootPaths: body.customRoots || [] }),
        });
        if (body.format === "markdown") {
          const markdown = planToMarkdown(plan);
          response.writeHead(200, {
            "content-type": "text/markdown; charset=utf-8",
            "content-disposition": 'attachment; filename="capability-map.md"',
            "content-length": Buffer.byteLength(markdown),
          });
          response.end(markdown);
          return;
        }
        sendJson(response, 200, plan);
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { error: "method-not-allowed" });
        return;
      }
      await serveStatic(url, response);
    } catch (error) {
      const clientMessages = new Set([
        "custom-roots-must-be-an-array",
        "too-many-custom-roots",
        "custom-root-too-broad",
        "expected-revision-required",
        "workflow-object-required",
        "workflow-goal-required",
        "workflow-stages-required",
        "workflow-patch-required",
        "suggestion-required",
        "external-candidate-required",
        "external-candidates-required",
        "external-candidate-source-required",
        "invalid-review-decision",
        "human-review-required",
        "human-validation-required",
        "human-confirmation-required",
        "project-id-required",
        "workflow-backup-invalid",
        "too-many-workflows",
        "workflow-stage-not-found",
        "workflow-capability-not-found",
        "project-brief-object-required",
        "project-brief-workflow-required",
        "project-brief-already-exists",
        "project-brief-patch-required",
        "human-project-brief-freeze-required",
        "too-many-project-briefs",
        "playbook-object-required",
        "playbook-workflow-required",
        "playbook-title-required",
        "playbook-stages-required",
        "playbook-already-exists",
        "playbook-patch-required",
        "playbook-project-brief-version-not-found",
        "human-playbook-confirmation-required",
        "frozen-project-brief-required",
        "too-many-playbooks",
        "playbook-progress-object-required",
        "playbook-progress-source-required",
        "human-playbook-progress-required",
        "playbook-progress-step-required",
        "playbook-progress-status-invalid",
        "playbook-progress-acceptance-invalid",
        "playbook-stage-not-applicable",
        "playbook-step-completion-requires-acceptance",
        "playbook-step-completion-requires-evidence",
        "playbook-gate-status-invalid",
        "playbook-gate-rationale-required",
        "playbook-stage-na-definition-required",
        "too-many-playbook-progress-sessions",
        "confirmed-playbook-progress-required",
        "playbook-review-hash-required",
        "playbook-export-format-invalid",
        "playbook-verification-object-required",
        "playbook-verification-level-invalid",
        "playbook-verification-summary-required",
        "playbook-verification-evidence-required",
        "playbook-verification-blockers-present",
        "playbook-verification-sample-required",
        "playbook-verification-environment-required",
        "playbook-verification-tester-required",
        "playbook-verification-assistance-invalid",
        "playbook-verification-hash-required",
        "playbook-sample-run-incomplete",
        "playbook-sample-run-verification-required",
        "confirmed-playbook-verification-required",
        "human-playbook-verification-required",
        "too-many-playbook-verification-records",
        "playbook-template-migration-required",
        "playbook-template-current",
        "playbook-template-target-changed",
        "playbook-template-preview-hash-required",
        "install-targets-required",
        "installation-plan-not-found",
        "installation-plan-not-configurable",
        "installation-plan-stale",
        "installation-items-required",
        "installation-job-not-found",
        "installation-item-not-found",
        "installation-needs-repair",
        "human-installation-approval-required",
        "repair-action-invalid",
        "external-install-rename-unsupported",
        "ecosystem-catalog-invalid",
        "ecosystem-skill-not-recordable",
        "ecosystem-skill-preview-unavailable",
        "ecosystem-skill-source-unsupported",
        "ecosystem-gap-required",
        "ecosystem-chain-skills-required",
        "ecosystem-item-not-chain",
        "skill-kit-object-required",
        "skill-kit-schema-unsupported",
        "skill-kit-skills-required",
        "skill-kit-skill-invalid",
        "skill-kit-external-package-invalid",
        "skill-kit-duplicate-skill",
        "skill-kit-hash-required",
        "skill-kit-hash-mismatch",
        "skill-kit-empty",
      ]);
      const isValidationError = error.message.startsWith("workflow-not-confirmable:")
        || error.message.startsWith("project-brief-not-freezable:")
        || error.message.startsWith("playbook-not-confirmable:")
        || error.message.startsWith("invalid-playbook-")
        || error.message.startsWith("duplicate-playbook-")
        || error.message.startsWith("playbook-stage-")
        || error.message.startsWith("playbook-step-")
        || error.message.startsWith("playbook-quality-")
        || error.message.startsWith("playbook-stage-dependency-gate-open:")
        || error.message.startsWith("playbook-stage-gate-incomplete:")
        || error.message.startsWith("playbook-stage-removal-not-allowed:")
        || error.message.startsWith("playbook-verification-order-required:")
        || error.message.startsWith("invalid-stage:")
        || error.message.startsWith("invalid-capability:")
        || error.message.startsWith("duplicate-")
        || error.message.startsWith("unknown-stage-dependency:")
        || error.message.startsWith("stage-dependency-must-precede:")
        || error.message.startsWith("stage-title-required:")
        || error.message.startsWith("stage-capabilities-required:")
        || error.message.startsWith("capability-label-required:")
        || error.message.startsWith("unknown-install-target:")
        || error.message.startsWith("installation-item-ineligible:")
        || error.message.startsWith("installation-risk-ack-required:")
        || error.message.startsWith("external-target-unsupported:");
      const status = typeof error.status === "number"
        ? error.status
        : error.message.startsWith("pdf-renderer-unavailable:")
        ? 503
        : error instanceof WorkflowConflictError
        ? 409
        : error.message === "installation-job-active" || error.message === "installation-plan-stale" || error.message === "installation-needs-repair"
          ? 409
        : error instanceof WorkflowNotFoundError || error.message === "skill-not-found"
          || error.message === "project-brief-not-found" || error.message === "project-brief-version-not-found"
          || error.message === "playbook-not-found" || error.message === "playbook-version-not-found"
          || error.message === "playbook-progress-not-started"
          || error.message === "playbook-stage-not-found" || error.message === "playbook-step-not-found"
          || error.message === "installation-plan-not-found" || error.message === "installation-job-not-found"
          || error.message === "installation-item-not-found"
          || error.message === "skill-kit-plan-not-found"
          || error.message === "ecosystem-item-not-found"
          || error.message === "ecosystem-group-not-found"
          || error.message === "ecosystem-skill-document-not-found"
          ? 404
          : error.message === "request-too-large"
        ? 413
        : error instanceof SyntaxError || clientMessages.has(error.message) || isValidationError
          ? 400
          : 500;
      sendJson(response, status, {
        error: status === 503 ? "service-unavailable" : status === 409 ? "conflict" : status === 404 ? "not-found" : status < 500 ? "invalid-request" : "internal-error",
        message: error.message,
        ...(error instanceof WorkflowConflictError ? { currentRevision: error.currentRevision } : {}),
      });
    }
  });
  server.installationManager = installations;
  server.ecosystemCatalog = ecosystemCatalog;
  return server;
}

export async function startServer({
  port = Number(process.env.PORT || 4317),
  host = process.env.HOST || "127.0.0.1",
} = {}) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;
  console.log(`Capability Atlas 0.6: http://${host}:${resolvedPort}`);
  console.log("Skill writes require a Web-confirmed installation plan; MCP tools cannot execute installation jobs.");
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
