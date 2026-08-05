import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { loadWorkflowTemplate } from "../lib/matcher.mjs";
import { WorkflowStore } from "../lib/workflow-store.mjs";

const SERVER_PATH = path.resolve(import.meta.dirname, "../mcp-server.mjs");

function output(result) {
  return JSON.parse(result.content.find((item) => item.type === "text").text);
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitUntilUnavailable(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await fetch(`${url}/api/health`);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

test("auto-starts the Web child with real stdio MCP tools without exposing human-only actions", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capability-atlas-mcp-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const seedStore = new WorkflowStore({ filePath: path.join(directory, "workspace.json") });
  const template = await loadWorkflowTemplate();
  const seed = await seedStore.createWorkflow({
    goal: "历史工作流",
    scopeDescription: "供 MCP 读取确认快照。",
    nonGoals: ["不允许 Agent 确认"],
    acceptanceCriteria: ["可以读取 v1"],
    stages: template.stages.slice(0, 1),
  }, { type: "human", name: "fixture-user", channel: "web" });
  await seedStore.confirmWorkflow(seed.id, { expectedRevision: seed.revision }, { type: "human", name: "fixture-user", channel: "web" });
  const webPort = await availablePort();
  const autoStartedUrl = `http://127.0.0.1:${webPort}`;
  const client = new Client({ name: "fixture-mcp-agent", version: "1.2.3" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: {
      ...process.env,
      CAPABILITY_ATLAS_DATA_DIR: directory,
      CAPABILITY_ATLAS_WEB_PORT: String(webPort),
      CAPABILITY_ATLAS_HOME_DIR: path.join(directory, "home"),
    },
    stderr: "pipe",
  });
  await client.connect(transport);
  let clientClosed = false;
  context.after(async () => {
    if (!clientClosed) await client.close();
  });

  const autoStartedHealth = await (await fetch(`${autoStartedUrl}/api/health`)).json();
  assert.equal(autoStartedHealth.app, "capability-atlas");
  assert.equal(autoStartedHealth.ok, true);

  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  assert.ok(names.includes("search_skills"));
  assert.ok(names.includes("create_workflow_draft"));
  assert.ok(names.includes("create_requirement_workflow_draft"));
  assert.ok(names.includes("find_external_skills"));
  assert.ok(names.includes("record_external_skill_candidate"));
  assert.ok(names.includes("assess_workflow"));
  assert.ok(names.includes("get_workflow_version"));
  assert.ok(names.includes("get_project_brief"));
  assert.ok(names.includes("get_project_brief_version"));
  assert.ok(names.includes("create_project_brief_draft"));
  assert.ok(names.includes("update_project_brief_draft"));
  assert.ok(names.includes("generate_playbook_draft"));
  assert.ok(names.includes("get_playbook"));
  assert.ok(names.includes("get_playbook_version"));
  assert.ok(names.includes("get_playbook_diff"));
  assert.ok(names.includes("get_playbook_template_status"));
  assert.ok(names.includes("preview_playbook_template_migration"));
  assert.ok(names.includes("migrate_playbook_template_draft"));
  assert.ok(names.includes("export_playbook"));
  assert.ok(names.includes("get_playbook_progress"));
  assert.ok(names.includes("get_playbook_verification"));
  assert.ok(names.includes("get_skill_content"));
  assert.ok(names.includes("open_web_ui"));
  assert.ok(names.includes("propose_skill_installation_plan"));
  assert.ok(names.includes("get_skill_installation_status"));
  assert.equal(names.includes("execute_skill_installation_plan"), false);
  assert.equal(names.includes("confirm_workflow"), false);
  assert.equal(names.includes("freeze_project_brief"), false);
  assert.equal(names.includes("confirm_playbook"), false);
  assert.equal(names.includes("update_playbook_progress"), false);
  assert.equal(names.includes("verify_playbook"), false);

  const prompts = await client.listPrompts();
  assert.ok(prompts.prompts.some((prompt) => prompt.name === "map_requirement_to_workflow"));
  const mappedPrompt = await client.getPrompt({
    name: "map_requirement_to_workflow",
    arguments: { goal: "开发 Android 应用", targetPlatforms: "Android" },
  });
  assert.match(mappedPrompt.messages[0].content.text, /create_requirement_workflow_draft/);
  assert.match(mappedPrompt.messages[0].content.text, /update_project_brief_draft/);
  assert.match(mappedPrompt.messages[0].content.text, /generate_playbook_draft/);
  assert.match(mappedPrompt.messages[0].content.text, /find_external_skills/);

  const opened = output(await client.callTool({
    name: "open_web_ui",
    arguments: { openBrowser: false },
  }));
  assert.equal(opened.ok, true);
  assert.equal(opened.status, "already-running");
  assert.equal(opened.lifecycle, "mcp-session");
  assert.equal(opened.browserOpened, false);
  assert.equal(opened.url, autoStartedUrl);

  const reopened = output(await client.callTool({
    name: "open_web_ui",
    arguments: { openBrowser: false },
  }));
  assert.equal(reopened.status, "already-running");
  assert.equal(reopened.url, opened.url);

  const confirmedVersion = output(await client.callTool({
    name: "get_workflow_version",
    arguments: { id: seed.id, version: 1 },
  }));
  assert.equal(confirmedVersion.snapshot.goal, "历史工作流");
  assert.equal(confirmedVersion.snapshot.confirmedBy.type, "human");

  const createdResult = await client.callTool({
    name: "create_workflow_draft",
    arguments: {
      goal: "实现 MCP 工作流缺口地图",
      scopeDescription: "由 Agent 提案、人工定稿。",
      nonGoals: ["不修改 Skill 文件"],
      acceptanceCriteria: ["Agent 可以写入草案"],
      stages: [{
        id: "design",
        phase: "定义",
        title: "定义能力",
        capabilities: [{ id: "requirements", label: "需求拆解", terms: ["requirements"] }],
      }],
    },
  });
  assert.equal(createdResult.isError, undefined);
  const created = output(createdResult);
  assert.equal(created.createdBy.name, "fixture-mcp-agent");
  assert.equal(created.createdBy.type, "agent");
  assert.equal(created.status, "draft");

  const fetched = output(await client.callTool({
    name: "get_workflow",
    arguments: { id: created.id },
  }));
  assert.equal(fetched.revision, 1);
  assert.equal(fetched.history.length, 0);

  const updated = output(await client.callTool({
    name: "update_workflow_draft",
    arguments: {
      id: created.id,
      expectedRevision: 1,
      patch: { goal: "实现可持久化的 MCP 工作流缺口地图" },
    },
  }));
  assert.equal(updated.revision, 2);
  assert.match(updated.goal, /持久化/);

  const recorded = output(await client.callTool({
    name: "record_external_skill_candidate",
    arguments: {
      id: created.id,
      expectedRevision: 2,
      stageId: "design",
      capabilityId: "requirements",
      query: "requirements workflow",
      packageId: "example/skills@requirements",
      sourceUrl: "https://skills.sh/example/skills/requirements",
      rationale: "补齐本机缺口，安装前仍需审查。",
      status: "accepted",
    },
  }));
  assert.equal(recorded.revision, 3);
  assert.equal(recorded.externalCandidates[0].packageId, "example/skills@requirements");

  const proposedInstall = output(await client.callTool({
    name: "propose_skill_installation_plan",
    arguments: {
      id: created.id,
      expectedRevision: recorded.revision,
      targetAgents: ["codex"],
    },
  }));
  assert.equal(proposedInstall.executionAllowed, false);
  assert.equal(proposedInstall.plan.items[0].type, "external-install");
  assert.equal("canonicalPath" in proposedInstall.plan.items[0], false);
  assert.equal("command" in proposedInstall.plan.items[0], false);

  const androidDraft = output(await client.callTool({
    name: "create_requirement_workflow_draft",
    arguments: {
      goal: "开发 Android 应用",
      requirement: { targetPlatforms: ["Android"], preferredStack: ["Kotlin", "Jetpack Compose"] },
    },
  }));
  assert.equal(androidDraft.stages[0].id, "frame-android-requirement");
  assert.equal(androidDraft.projectBrief.status, "draft");
  assert.equal(androidDraft.projectBrief.completeness.complete, false);

  const completedBrief = output(await client.callTool({
    name: "update_project_brief_draft",
    arguments: {
      workflowId: androidDraft.id,
      expectedRevision: androidDraft.projectBrief.revision,
      patch: {
        targetUsers: ["Android 手机用户"],
        primaryOutcome: "用户能完成应用主任务",
        inScope: ["端到端主流程"],
        outOfScope: ["平板专用布局"],
        constraints: ["首版仅支持 Android"],
        successCriteria: ["主流程在真机验收通过"],
      },
    },
  }));
  assert.equal(completedBrief.completeness.complete, true);
  assert.equal(completedBrief.completeness.nextQuestion, null);

  const frozenBriefResponse = await fetch(`${autoStartedUrl}/api/workflows/${androidDraft.id}/brief/freeze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: completedBrief.revision }),
  });
  const frozenBrief = await frozenBriefResponse.json();
  assert.equal(frozenBriefResponse.status, 200);
  assert.equal(frozenBrief.status, "frozen");
  const frozenBriefVersion = output(await client.callTool({
    name: "get_project_brief_version",
    arguments: { workflowId: androidDraft.id, version: 1 },
  }));
  assert.equal(frozenBriefVersion.snapshot.frozenBy.type, "human");

  const playbook = output(await client.callTool({
    name: "generate_playbook_draft",
    arguments: { workflowId: androidDraft.id, briefVersion: 1 },
  }));
  assert.equal(playbook.status, "draft");
  assert.equal(playbook.stages.every((stage) => stage.steps[0].execution.autoExecutionAllowed === false), true);
  assert.equal(playbook.source.projectBriefVersion, 1);
  const templateStatus = output(await client.callTool({
    name: "get_playbook_template_status",
    arguments: { workflowId: androidDraft.id },
  }));
  assert.equal(templateStatus.migrationRequired, false);
  assert.equal(templateStatus.currentTemplate.contentHash.length, 64);

  const confirmedPlaybookResponse = await fetch(`${autoStartedUrl}/api/workflows/${androidDraft.id}/playbook/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: playbook.revision, reviewedContentHash: playbook.contentHash }),
  });
  const confirmedPlaybook = await confirmedPlaybookResponse.json();
  assert.equal(confirmedPlaybookResponse.status, 200);
  assert.equal(confirmedPlaybook.verificationLevel, "maintainer-reviewed");
  const playbookVersion = output(await client.callTool({
    name: "get_playbook_version",
    arguments: { workflowId: androidDraft.id, version: 1 },
  }));
  assert.equal(playbookVersion.snapshot.confirmedBy.type, "human");
  const handbook = output(await client.callTool({
    name: "export_playbook",
    arguments: { workflowId: androidDraft.id, format: "markdown" },
  }));
  assert.match(handbook.markdown, /从 0 到 1 开发手册/);
  assert.match(handbook.markdown, new RegExp(confirmedPlaybook.contentHash));
  const startedProgressResponse = await fetch(`${autoStartedUrl}/api/workflows/${androidDraft.id}/playbook/progress/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(startedProgressResponse.status, 201);
  const observedProgress = output(await client.callTool({
    name: "get_playbook_progress",
    arguments: { workflowId: androidDraft.id },
  }));
  assert.equal(observedProgress.current.playbookContentHash, confirmedPlaybook.contentHash);
  const observedVerification = output(await client.callTool({
    name: "get_playbook_verification",
    arguments: { workflowId: androidDraft.id },
  }));
  assert.equal(observedVerification.currentLevel, "maintainer-reviewed");
  assert.equal(observedVerification.nextLevel, "sample-run");

  const conflict = await client.callTool({
    name: "update_workflow_draft",
    arguments: {
      id: created.id,
      expectedRevision: 1,
      patch: { goal: "不应覆盖" },
    },
  });
  assert.equal(conflict.isError, true);
  assert.match(conflict.content[0].text, /workflow-revision-conflict/);

  await client.close();
  clientClosed = true;
  assert.equal(await waitUntilUnavailable(autoStartedUrl), true);
});
