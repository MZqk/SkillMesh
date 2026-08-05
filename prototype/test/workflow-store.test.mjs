import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadWorkflowTemplate } from "../lib/matcher.mjs";
import { compilePlaybookDraft } from "../lib/playbook-compiler.mjs";
import { WorkflowConflictError, WorkflowStore } from "../lib/workflow-store.mjs";

test("persists optimistic drafts and immutable human confirmation history", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capability-atlas-store-"));
  const filePath = path.join(directory, "workspace.json");
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new WorkflowStore({ filePath });
  const template = await loadWorkflowTemplate();
  const agent = { type: "agent", name: "fixture-agent", version: "1", channel: "mcp" };
  const human = { type: "human", name: "fixture-user", channel: "web" };

  const draft = await store.createWorkflow({
    goal: "开发一个 Skill 缺口页面",
    scope: "global",
    stages: template.stages.slice(0, 2),
  }, agent);
  assert.equal(draft.revision, 1);
  assert.equal(draft.createdBy.name, "fixture-agent");
  await assert.rejects(
    store.confirmWorkflow(draft.id, { expectedRevision: 1 }, human),
    /workflow-not-confirmable:scopeDescription,nonGoals,acceptanceCriteria/,
  );

  const updated = await store.updateWorkflow(draft.id, {
    expectedRevision: 1,
    patch: {
      scopeDescription: "展示功能工作流所需能力与本机 Skill 证据。",
      nonGoals: ["不自动安装或执行 Skill"],
      acceptanceCriteria: ["网页能区分已覆盖、缺失和待优化能力"],
    },
  }, agent);
  assert.equal(updated.revision, 2);
  await assert.rejects(
    store.updateWorkflow(draft.id, { expectedRevision: 1, patch: { goal: "stale write" } }, agent),
    (error) => error instanceof WorkflowConflictError && error.currentRevision === 2,
  );

  const confirmed = await store.confirmWorkflow(draft.id, { expectedRevision: 2 }, human);
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.confirmedVersion, 1);
  assert.equal(confirmed.confirmedBy.type, "human");

  const revised = await store.updateWorkflow(draft.id, {
    expectedRevision: confirmed.revision,
    patch: { goal: "开发一个可由多个 Agent 更新的 Skill 缺口页面" },
  }, agent);
  assert.equal(revised.status, "draft");
  assert.equal(revised.baseConfirmationVersion, 1);

  const reloaded = new WorkflowStore({ filePath });
  const persisted = await reloaded.getWorkflow(draft.id, { includeHistory: true });
  const snapshot = await reloaded.getConfirmation(draft.id, 1);
  assert.equal(persisted.goal, revised.goal);
  assert.equal(persisted.history.length, 1);
  assert.equal(snapshot.snapshot.goal, "开发一个 Skill 缺口页面");
  assert.equal(snapshot.snapshot.status, "confirmed");
});

test("shares custom scan roots through the local store", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capability-atlas-settings-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "workspace.json");
  const first = new WorkflowStore({ filePath });
  const second = new WorkflowStore({ filePath });

  await first.updateSettings({ customRoots: ["/work/skills", "/work/skills"] });
  assert.deepEqual(await second.getSettings(), { customRoots: ["/work/skills"], revision: 1 });
});

test("merges workflow backups idempotently without deleting existing data", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capability-atlas-import-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = new WorkflowStore({ filePath: path.join(directory, "source.json") });
  const target = new WorkflowStore({ filePath: path.join(directory, "target.json") });
  const template = await loadWorkflowTemplate();
  const human = { type: "human", name: "fixture-user", channel: "web" };
  const workflow = await source.createWorkflow({
    goal: "可备份工作流",
    scopeDescription: "测试安全合并。",
    nonGoals: ["不删除目标数据"],
    acceptanceCriteria: ["重复导入不会复制"],
    stages: template.stages.slice(0, 1),
  }, human);
  await source.confirmWorkflow(workflow.id, { expectedRevision: workflow.revision }, human);
  const backup = await source.exportData();

  const first = await target.importData(backup, human);
  const second = await target.importData(backup, human);
  const imported = await target.getWorkflow(workflow.id, { includeHistory: true });

  assert.deepEqual(first, { imported: 1, skipped: 0, confirmationVersions: 1, total: 1 });
  assert.deepEqual(second, { imported: 0, skipped: 1, confirmationVersions: 0, total: 1 });
  assert.equal(imported.history.length, 1);
  assert.equal((await target.listWorkflows()).total, 1);
});

test("versions a frozen Project Brief and a maintainer-confirmed Playbook independently", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capability-atlas-playbook-store-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new WorkflowStore({ filePath: path.join(directory, "workspace.json") });
  const template = await loadWorkflowTemplate();
  const agent = { type: "agent", name: "fixture-agent", channel: "mcp" };
  const human = { type: "human", name: "fixture-user", channel: "web" };
  const workflow = await store.createWorkflow({
    goal: "开发任务协作 Web 应用",
    scopeDescription: "交付可部署 MVP。",
    nonGoals: ["不做企业 SSO"],
    acceptanceCriteria: ["主流程通过浏览器验收"],
    stages: template.stages,
  }, agent);
  const brief = await store.createProjectBrief(workflow.id, {
    sourceGoal: workflow.goal,
    projectName: "任务灯塔",
    problemStatement: "团队遗漏交接任务。",
    targetUsers: ["小团队"],
    primaryOutcome: "处理今日逾期任务。",
    inScope: ["任务主流程"],
    outOfScope: ["企业 SSO"],
    constraints: ["两周 MVP"],
    successCriteria: ["主流程验收通过"],
    targetPlatforms: ["Web"],
    preferredStack: ["Next.js App Router", "TypeScript", "PostgreSQL", "Playwright"],
  }, agent);
  await assert.rejects(
    store.freezeProjectBrief(workflow.id, { expectedRevision: brief.revision }, agent),
    /human-project-brief-freeze-required/,
  );
  const frozen = await store.freezeProjectBrief(workflow.id, { expectedRevision: brief.revision }, human);
  assert.equal(frozen.status, "frozen");
  assert.equal(frozen.frozenVersion, 1);

  const generated = await compilePlaybookDraft({ workflow, projectBrief: frozen });
  const playbook = await store.createPlaybook(workflow.id, generated, agent);
  assert.equal(playbook.status, "draft");
  assert.equal(playbook.verificationLevel, "agent-generated");
  assert.equal(playbook.stages.length, 9);
  const initialDiff = await store.getPlaybookDiff(workflow.id);
  assert.equal(initialDiff.summary.initialVersion, true);
  assert.equal(initialDiff.currentContentHash, playbook.contentHash);
  const confirmed = await store.confirmPlaybook(workflow.id, {
    expectedRevision: playbook.revision,
    reviewedContentHash: initialDiff.currentContentHash,
  }, human);
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.verificationLevel, "maintainer-reviewed");
  assert.equal(confirmed.confirmedVersion, 1);

  const revisedBrief = await store.updateProjectBrief(workflow.id, {
    expectedRevision: frozen.revision,
    patch: { constraints: ["一周 MVP"] },
  }, human);
  assert.equal(revisedBrief.status, "draft");
  assert.equal(revisedBrief.baseFrozenVersion, 1);
  const revisedPlaybook = await store.updatePlaybook(workflow.id, {
    expectedRevision: confirmed.revision,
    patch: { summary: "根据新约束重新生成。" },
  }, agent);
  assert.equal(revisedPlaybook.status, "draft");
  assert.equal(revisedPlaybook.baseConfirmationVersion, 1);
  const revisionDiff = await store.getPlaybookDiff(workflow.id);
  assert.equal(revisionDiff.baseVersion, 1);
  assert.equal(revisionDiff.changes.some((item) => item.path === "summary"), true);
  assert.equal((await store.getProjectBriefVersion(workflow.id, 1)).snapshot.constraints[0], "两周 MVP");
  assert.equal((await store.getPlaybookVersion(workflow.id, 1)).snapshot.summary.includes("按九阶段编排本机 Skill"), true);

  const backup = await store.exportData();
  const restored = new WorkflowStore({ filePath: path.join(directory, "restored.json") });
  await restored.importData(backup, human);
  assert.equal((await restored.getProjectBrief(workflow.id, { includeHistory: true })).history.length, 1);
  assert.equal((await restored.getPlaybook(workflow.id, { includeHistory: true })).history.length, 1);
});
