import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer } from "../server.mjs";
import { CatalogService } from "../lib/catalog-service.mjs";
import { WorkflowStore } from "../lib/workflow-store.mjs";

test("serves a local Web-approved installation health contract", async (context) => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    app: "capability-atlas",
    ok: true,
    readOnly: false,
    skillFilesystem: "human-approved-managed-writes",
    installationExecution: "web-only",
    workflowPersistence: true,
    mcpTransport: "stdio",
    version: "0.7.0",
  });
});

test("shares QuickSkillState across Web requests with migration and optimistic conflicts", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmesh-quick-api-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new WorkflowStore({ filePath: path.join(directory, "workspace.json") });
  const server = createServer({ store });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const initial = await (await fetch(`${baseUrl}/api/quick-skill-state`)).json();
  assert.equal(initial.revision, 0);
  const migration = await (await fetch(`${baseUrl}/api/quick-skill-state/migrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ preferences: { favorites: ["legacy"] } }),
  })).json();
  assert.equal(migration.migrated, true);
  assert.equal(migration.state.legacyWebMigrationCompleted, true);

  const updatedResponse = await fetch(`${baseUrl}/api/quick-skill-state`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expectedRevision: migration.state.revision,
      operation: { type: "set-favorite", contentHash: "legacy", favorite: false },
    }),
  });
  const updated = await updatedResponse.json();
  assert.equal(updatedResponse.status, 200);
  assert.deepEqual(updated.favorites, []);

  const conflictResponse = await fetch(`${baseUrl}/api/quick-skill-state`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expectedRevision: migration.state.revision,
      operation: { type: "record-use", contentHash: "legacy" },
    }),
  });
  assert.equal(conflictResponse.status, 409);
  assert.equal((await conflictResponse.json()).currentRevision, updated.revision);

  const replay = await (await fetch(`${baseUrl}/api/quick-skill-state/migrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ preferences: { favorites: ["legacy"] } }),
  })).json();
  assert.equal(replay.migrated, false);
  assert.deepEqual(replay.state.favorites, []);
});

test("rejects dangerously broad custom scan roots", async (context) => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/scan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ customRoots: ["/"] }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "invalid-request");
  assert.equal(body.message, "custom-root-too-broad");
});

test("scans an explicit custom root without exposing Skill body text", async (context) => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "capability-atlas-api-root-"));
  const skillDirectory = path.join(rootPath, "api-fixture-capability");
  await fs.mkdir(skillDirectory);
  await fs.writeFile(
    path.join(skillDirectory, "SKILL.md"),
    "---\nname: api-fixture-capability\ndescription: Proves custom root discovery.\n---\nPRIVATE_BODY_SENTINEL\n",
  );
  context.after(() => fs.rm(rootPath, { recursive: true, force: true }));

  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/scan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ customRoots: [rootPath] }),
  });
  const raw = await response.text();
  const body = JSON.parse(raw);
  const fixture = body.skills.find((skill) => skill.name === "api-fixture-capability");

  assert.equal(response.status, 200);
  assert.equal(fixture.provider, "extra");
  assert.equal(fixture.scope, "custom");
  assert.equal(fixture.rootStability, "user-configured");
  assert.equal("searchText" in fixture, false);
  assert.doesNotMatch(raw, /PRIVATE_BODY_SENTINEL/);
});

test("serves one bounded local Skill document only after an explicit content request", async (context) => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "capability-atlas-local-document-"));
  context.after(() => fs.rm(rootPath, { recursive: true, force: true }));
  const skillDirectory = path.join(rootPath, "document-fixture");
  await fs.mkdir(skillDirectory);
  await fs.writeFile(path.join(skillDirectory, "SKILL.md"), [
    "---",
    "name: document-fixture",
    "description: Explicit local document review fixture.",
    "---",
    "LOCAL_DOCUMENT_SENTINEL",
    "",
  ].join("\n"));
  const store = new WorkflowStore({ filePath: path.join(rootPath, "workspace.json") });
  const service = new CatalogService({ store });
  service.resolvedRoots = () => [{
    path: rootPath,
    provider: "fixture",
    scope: "custom",
    label: "Fixture",
    stability: "test",
    sourceKind: "direct",
  }];
  const server = createServer({ store, service });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const inventoryRaw = await (await fetch(`${baseUrl}/api/scan?refresh=1`)).text();
  assert.doesNotMatch(inventoryRaw, /LOCAL_DOCUMENT_SENTINEL/);
  const inventory = JSON.parse(inventoryRaw);
  const fixture = inventory.skills.find((skill) => skill.name === "document-fixture");
  const response = await fetch(`${baseUrl}/api/skills/${fixture.contentHash}/content?maxChars=1000`);
  const document = await response.json();

  assert.equal(response.status, 200);
  assert.equal(document.untrustedContent, true);
  assert.match(document.content, /LOCAL_DOCUMENT_SENTINEL/);
  assert.doesNotMatch(JSON.stringify(document), new RegExp(rootPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("persists, confirms, exports, and conflict-checks shared workflows", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capability-atlas-api-store-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new WorkflowStore({ filePath: path.join(directory, "workspace.json") });
  const server = createServer({ store });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const createdResponse = await fetch(`${baseUrl}/api/workflows`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "展示 Skill 缺口",
      scopeDescription: "展示功能能力与本机 Skill 证据。",
      nonGoals: ["不执行 Skill"],
      acceptanceCriteria: ["缺失能力清晰可见"],
    }),
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 201);
  assert.equal(created.status, "draft");
  assert.equal(created.stages.length, 4);
  assert.equal(created.stages[0].id, "clarify-outcome");

  const confirmedResponse = await fetch(`${baseUrl}/api/workflows/${created.id}/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: created.revision }),
  });
  const confirmed = await confirmedResponse.json();
  assert.equal(confirmedResponse.status, 200);
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.confirmedVersion, 1);

  const conflictResponse = await fetch(`${baseUrl}/api/workflows/${created.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: 1, patch: { goal: "stale" } }),
  });
  assert.equal(conflictResponse.status, 409);
  assert.equal((await conflictResponse.json()).currentRevision, confirmed.revision);

  const history = await (await fetch(`${baseUrl}/api/workflows/${created.id}/history`)).json();
  const version = await (await fetch(`${baseUrl}/api/workflows/${created.id}/history/1`)).json();
  const backup = await (await fetch(`${baseUrl}/api/workspace/export`)).json();
  assert.equal(history.items.length, 1);
  assert.equal(version.snapshot.goal, "展示 Skill 缺口");
  assert.equal(version.snapshot.status, "confirmed");
  assert.equal(version.assessment.stages.length, 4);
  assert.equal(version.assessment.inventory.paths >= 0, true);
  assert.doesNotMatch(JSON.stringify(version.assessment), /"path"|"realPath"|searchText|excerpt/);
  assert.equal(backup.kind, "capability-atlas-shared-workspace");
  assert.equal(backup.data.confirmations.length, 1);
  assert.doesNotMatch(JSON.stringify(backup), /searchText|PRIVATE_BODY_SENTINEL/);
});

test("guides, freezes, and versions a Project Brief before generating a manual Playbook", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capability-atlas-api-playbook-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new WorkflowStore({ filePath: path.join(directory, "workspace.json") });
  let pdfSource = null;
  const server = createServer({
    store,
    pdfRenderer: async (source) => {
      pdfSource = source;
      return Buffer.from("%PDF-1.7\n% same-source-test\n");
    },
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const createdResponse = await fetch(`${baseUrl}/api/workflows`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "开发任务协作 Web 应用",
      scopeDescription: "帮助小团队发现并处理逾期交接任务。",
      requirement: {
        targetPlatforms: ["Web"],
        targetUsers: ["小团队负责人"],
        preferredStack: ["Next.js App Router", "TypeScript", "PostgreSQL", "Playwright"],
        constraints: ["两周内交付 MVP"],
        desiredOutputs: ["可部署的任务主流程"],
      },
      nonGoals: ["不做企业级 SSO"],
      acceptanceCriteria: ["主流程在真实浏览器通过"],
    }),
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 201);
  assert.equal(created.stages.length, 9);
  assert.equal(created.projectBrief.completeness.complete, true);

  const frozenResponse = await fetch(`${baseUrl}/api/workflows/${created.id}/brief/freeze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: created.projectBrief.revision }),
  });
  const frozen = await frozenResponse.json();
  assert.equal(frozenResponse.status, 200);
  assert.equal(frozen.status, "frozen");
  assert.equal(frozen.frozenVersion, 1);

  const generatedResponse = await fetch(`${baseUrl}/api/workflows/${created.id}/playbook/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ briefVersion: 1 }),
  });
  const generated = await generatedResponse.json();
  assert.equal(generatedResponse.status, 201);
  assert.equal(generated.status, "draft");
  assert.equal(generated.stages.length, 9);
  assert.equal(generated.stages[0].mode, "vibe");
  assert.equal(generated.stages[4].mode, "loop");
  assert.equal(generated.stages.every((stage) => stage.steps[0].execution.mode === "manual"), true);
  assert.equal(generated.stages.every((stage) => stage.steps[0].execution.autoExecutionAllowed === false), true);
  assert.equal(generated.source.templateContentHash.length, 64);
  const templateStatus = await (await fetch(`${baseUrl}/api/workflows/${created.id}/playbook/template-status`)).json();
  assert.equal(templateStatus.migrationRequired, false);
  assert.equal(templateStatus.targetTemplate.contentHash, generated.source.templateContentHash);

  const initialDiff = await (await fetch(`${baseUrl}/api/workflows/${created.id}/playbook/diff`)).json();
  assert.equal(initialDiff.summary.initialVersion, true);
  assert.equal(initialDiff.currentContentHash, generated.contentHash);

  const unreviewedConfirmation = await fetch(`${baseUrl}/api/workflows/${created.id}/playbook/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: generated.revision }),
  });
  assert.equal(unreviewedConfirmation.status, 400);
  assert.equal((await unreviewedConfirmation.json()).message, "playbook-review-hash-required");

  const confirmedResponse = await fetch(`${baseUrl}/api/workflows/${created.id}/playbook/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: generated.revision, reviewedContentHash: initialDiff.currentContentHash }),
  });
  const confirmed = await confirmedResponse.json();
  assert.equal(confirmedResponse.status, 200);
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.verificationLevel, "maintainer-reviewed");
  assert.equal(confirmed.contentHash.length, 64);

  const verificationResponse = await fetch(`${baseUrl}/api/workflows/${created.id}/playbook/verification`);
  const verification = await verificationResponse.json();
  assert.equal(verificationResponse.status, 200);
  assert.equal(verification.currentLevel, "maintainer-reviewed");
  assert.equal(verification.eligible, false);
  const prematureVerification = await fetch(`${baseUrl}/api/workflows/${created.id}/playbook/verification`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expectedRevision: confirmed.revision,
      reviewedContentHash: confirmed.contentHash,
      level: "sample-run",
      summary: "尚未完成全部进度。",
      sampleName: "未完成样例",
      environment: "fixture",
      evidence: [{ kind: "note", value: "未完成" }],
    }),
  });
  assert.equal(prematureVerification.status, 400);
  assert.equal((await prematureVerification.json()).message, "playbook-sample-run-incomplete");

  const startedProgressResponse = await fetch(`${baseUrl}/api/workflows/${created.id}/playbook/progress/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  let progress = await startedProgressResponse.json();
  assert.equal(startedProgressResponse.status, 201);
  assert.equal(progress.playbookContentHash, confirmed.contentHash);
  const firstStep = confirmed.stages[0].steps[0];
  progress = await (await fetch(`${baseUrl}/api/workflows/${created.id}/playbook/progress/steps`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expectedRevision: progress.revision,
      stageId: confirmed.stages[0].id,
      stepId: firstStep.id,
      status: "completed",
      acceptanceResult: "passed",
      notes: "问题陈述已人工检查。",
    }),
  })).json();
  assert.equal(progress.steps[0].status, "completed");
  const progressView = await (await fetch(`${baseUrl}/api/workflows/${created.id}/playbook/progress`)).json();
  assert.equal(progressView.current.id, progress.id);
  assert.equal(progressView.summary.completedSteps, 1);

  const briefVersion = await (await fetch(`${baseUrl}/api/workflows/${created.id}/brief/history/1`)).json();
  const playbookVersion = await (await fetch(`${baseUrl}/api/workflows/${created.id}/playbook/history/1`)).json();
  const markdownResponse = await fetch(`${baseUrl}/api/workflows/${created.id}/playbook/export?format=markdown`);
  const markdown = await markdownResponse.text();
  const pdfResponse = await fetch(`${baseUrl}/api/workflows/${created.id}/playbook/export?format=pdf`);
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  const backup = await (await fetch(`${baseUrl}/api/workspace/export`)).json();
  assert.equal(briefVersion.snapshot.projectName, "开发任务协作 Web 应用");
  assert.equal(playbookVersion.snapshot.source.projectBriefVersion, 1);
  assert.equal(markdownResponse.status, 200);
  assert.match(markdownResponse.headers.get("content-type"), /text\/markdown/);
  assert.match(markdown, new RegExp(confirmed.contentHash));
  assert.match(markdown, /## 阶段 9：从真实使用中学习/);
  assert.equal(pdfResponse.status, 200);
  assert.equal(pdfResponse.headers.get("content-type"), "application/pdf");
  assert.match(pdfResponse.headers.get("content-disposition"), /development-playbook\.pdf/);
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.equal(pdfSource.playbook.contentHash, confirmed.contentHash);
  assert.equal(pdfSource.projectBrief.frozenVersion, 1);
  assert.equal(pdfSource.verification.currentLevel, "maintainer-reviewed");
  assert.equal(backup.data.projectBriefConfirmations.length, 1);
  assert.equal(backup.data.playbookConfirmations.length, 1);
  assert.equal(backup.data.playbookProgress.length, 1);
});
