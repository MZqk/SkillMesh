import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadWorkflowTemplate } from "../lib/matcher.mjs";
import { compilePlaybookDraft } from "../lib/playbook-compiler.mjs";
import { legacyPlaybookContentHashV1 } from "../lib/playbook-model.mjs";
import { WorkflowStore } from "../lib/workflow-store.mjs";

async function seededStore(context, { depth = "full" } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capability-atlas-progress-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new WorkflowStore({ filePath: path.join(directory, "workspace.json") });
  const template = await loadWorkflowTemplate();
  const agent = { type: "agent", name: "fixture-agent", channel: "mcp" };
  const human = { type: "human", name: "fixture-user", channel: "web" };
  const workflow = await store.createWorkflow({
    goal: "开发 Web MVP",
    scopeDescription: "验证 Playbook 进度。",
    nonGoals: ["不自动执行"],
    acceptanceCriteria: ["进度绑定内容哈希"],
    stages: template.stages,
  }, agent);
  const brief = await store.createProjectBrief(workflow.id, {
    projectName: "进度样例",
    problemStatement: "初级开发者缺少流程。",
    targetUsers: ["初级开发者"],
    primaryOutcome: "完成可部署 MVP。",
    inScope: ["Web 主流程"],
    outOfScope: ["企业功能"],
    constraints: ["人工执行"],
    successCriteria: ["主路径通过"],
    targetPlatforms: ["Web"],
    preferredStack: ["Next.js App Router", "TypeScript", "PostgreSQL", "Playwright"],
  }, agent);
  const frozen = await store.freezeProjectBrief(workflow.id, { expectedRevision: brief.revision }, human);
  const draftPlaybook = await store.createPlaybook(
    workflow.id,
    await compilePlaybookDraft({ workflow, projectBrief: frozen, depth }),
    agent,
  );
  const playbook = await store.confirmPlaybook(workflow.id, {
    expectedRevision: draftPlaybook.revision,
    reviewedContentHash: draftPlaybook.contentHash,
  }, human);
  return { store, workflow, playbook, agent, human, directory };
}

test("completes a condensed step and advances its quality gate in one write", async (context) => {
  const { store, workflow, playbook, human } = await seededStore(context, { depth: "quick" });
  let progress = await store.startPlaybookProgress(workflow.id, human);
  const softStage = playbook.stages[0];
  progress = await store.completePlaybookStepAndAdvance(workflow.id, {
    expectedRevision: progress.revision,
    stageId: softStage.id,
    stepId: softStage.steps[0].id,
  }, human);
  assert.equal(progress.revision, 2);
  assert.equal(progress.steps[0].status, "completed");
  assert.equal(progress.steps[0].acceptanceResult, "passed");
  assert.equal(progress.gates[0].status, "passed");

  const hardStage = playbook.stages[1];
  await assert.rejects(store.completePlaybookStepAndAdvance(workflow.id, {
    expectedRevision: progress.revision,
    stageId: hardStage.id,
    stepId: hardStage.steps[0].id,
  }, human), /playbook-step-completion-requires-evidence/);
  progress = await store.completePlaybookStepAndAdvance(workflow.id, {
    expectedRevision: progress.revision,
    stageId: hardStage.id,
    stepId: hardStage.steps[0].id,
    notes: "端到端结果已经人工验收。",
    evidence: [{ kind: "note", label: "完成证据", value: "端到端结果已经人工验收。" }],
  }, human);
  assert.equal(progress.revision, 3);
  assert.equal(progress.gates.find((item) => item.stageId === hardStage.id).status, "passed");
});

test("persists hash-bound step evidence and enforces graded gates", async (context) => {
  const { store, workflow, playbook, agent, human } = await seededStore(context);
  await assert.rejects(store.startPlaybookProgress(workflow.id, agent), /human-playbook-progress-required/);
  let progress = await store.startPlaybookProgress(workflow.id, human);
  assert.equal(progress.revision, 1);

  const firstStage = playbook.stages[0];
  progress = await store.updatePlaybookStepProgress(workflow.id, {
    expectedRevision: progress.revision,
    stageId: firstStage.id,
    stepId: firstStage.steps[0].id,
    status: "completed",
    acceptanceResult: "passed",
    notes: "问题陈述已评审。",
  }, human);
  await assert.rejects(store.setPlaybookGateProgress(workflow.id, {
    expectedRevision: progress.revision,
    stageId: firstStage.id,
    status: "passed",
    rationale: "仍有一步没有达到完成标准。",
  }, human), /playbook-stage-gate-incomplete/);
  progress = await store.updatePlaybookStepProgress(workflow.id, {
    expectedRevision: progress.revision,
    stageId: firstStage.id,
    stepId: firstStage.steps[1].id,
    status: "completed",
    acceptanceResult: "passed",
    notes: "危险假设已排序。",
  }, human);
  progress = await store.setPlaybookGateProgress(workflow.id, {
    expectedRevision: progress.revision,
    stageId: firstStage.id,
    status: "passed",
    rationale: "保留一项已标注假设后继续。",
  }, human);
  assert.equal(progress.gates[0].status, "passed");

  for (const stage of playbook.stages.slice(1, 4)) {
    for (const step of stage.steps) {
      progress = await store.updatePlaybookStepProgress(workflow.id, {
        expectedRevision: progress.revision,
        stageId: stage.id,
        stepId: step.id,
        status: "completed",
        acceptanceResult: "passed",
        notes: "步骤达到完成标准。",
      }, human);
    }
    progress = await store.setPlaybookGateProgress(workflow.id, {
      expectedRevision: progress.revision,
      stageId: stage.id,
      status: "passed",
      rationale: "全部步骤已完成并验收。",
    }, human);
  }

  const buildStage = playbook.stages[4];
  const implementStage = playbook.stages[5];
  await assert.rejects(store.updatePlaybookStepProgress(workflow.id, {
    expectedRevision: progress.revision,
    stageId: implementStage.id,
    stepId: implementStage.steps[0].id,
    status: "in-progress",
  }, human), /playbook-stage-dependency-gate-open/);

  for (const step of buildStage.steps) {
    progress = await store.updatePlaybookStepProgress(workflow.id, {
      expectedRevision: progress.revision,
      stageId: buildStage.id,
      stepId: step.id,
      status: "completed",
      acceptanceResult: "passed",
      notes: "已人工验收。",
      evidence: [{ kind: "test-result", label: "验收记录", value: "本地检查通过" }],
    }, human);
  }
  progress = await store.setPlaybookGateProgress(workflow.id, {
    expectedRevision: progress.revision,
    stageId: buildStage.id,
    status: "passed",
    rationale: "所有硬门步骤与证据已核对。",
  }, human);
  progress = await store.updatePlaybookStepProgress(workflow.id, {
    expectedRevision: progress.revision,
    stageId: implementStage.id,
    stepId: implementStage.steps[0].id,
    status: "in-progress",
  }, human);
  assert.equal(progress.steps.find((item) => item.stageId === implementStage.id).status, "in-progress");

  const current = await store.getPlaybookProgress(workflow.id);
  assert.equal(current.current.id, progress.id);
  assert.equal(current.summary.completedSteps, 10);
  const changed = await store.updatePlaybook(workflow.id, {
    expectedRevision: playbook.revision,
    patch: { summary: "内容已重新生成。" },
  }, agent);
  const stale = await store.getPlaybookProgress(workflow.id);
  assert.equal(changed.revision, 3);
  assert.equal(stale.current, null);
  assert.equal(stale.staleSessions.length, 1);
});

test("migrates legacy verification-bound hashes without orphaning progress", async (context) => {
  const { store, workflow, playbook, human, directory } = await seededStore(context);
  let progress = await store.startPlaybookProgress(workflow.id, human);
  progress = await store.updatePlaybookStepProgress(workflow.id, {
    expectedRevision: progress.revision,
    stageId: playbook.stages[0].id,
    stepId: playbook.stages[0].steps[0].id,
    status: "completed",
    acceptanceResult: "passed",
    notes: "旧版哈希迁移样例。",
  }, human);

  const backup = await store.exportData();
  const legacyHash = legacyPlaybookContentHashV1(backup.playbooks[0]);
  delete backup.playbookContentHashVersion;
  backup.playbookConfirmations[0].contentHash = legacyHash;
  backup.playbookProgress[0].playbookContentHash = legacyHash;
  await fs.writeFile(path.join(directory, "workspace.json"), `${JSON.stringify(backup, null, 2)}\n`);

  const reloaded = new WorkflowStore({ filePath: path.join(directory, "workspace.json") });
  const current = await reloaded.getPlaybookProgress(workflow.id);
  const version = await reloaded.getPlaybookVersion(workflow.id, 1);
  const migrated = await reloaded.exportData();
  assert.equal(current.current.id, progress.id);
  assert.equal(current.summary.completedSteps, 1);
  assert.equal(current.staleSessions.length, 0);
  assert.equal(version.contentHash, playbook.contentHash);
  assert.equal(migrated.playbookContentHashVersion, 2);
  assert.equal(migrated.playbookProgress[0].playbookContentHash, playbook.contentHash);

  const importedStore = new WorkflowStore({ filePath: path.join(directory, "imported.json") });
  await importedStore.importData(backup, human);
  const imported = await importedStore.getPlaybookProgress(workflow.id);
  assert.equal(imported.current.id, progress.id);
  assert.equal(imported.summary.completedSteps, 1);
  assert.equal(imported.staleSessions.length, 0);
});
