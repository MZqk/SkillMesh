import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadWorkflowTemplate } from "../lib/matcher.mjs";
import { compilePlaybookDraft } from "../lib/playbook-compiler.mjs";
import { WorkflowStore } from "../lib/workflow-store.mjs";

async function confirmedPlaybook(context) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capability-atlas-verification-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new WorkflowStore({ filePath: path.join(directory, "workspace.json") });
  const template = await loadWorkflowTemplate();
  const agent = { type: "agent", name: "fixture-agent", channel: "mcp" };
  const human = { type: "human", name: "fixture-user", channel: "web" };
  const workflow = await store.createWorkflow({
    goal: "让初级开发者完成 Web MVP",
    scopeDescription: "验证手册验证等级。",
    nonGoals: ["不自动执行"],
    acceptanceCriteria: ["验证记录绑定内容哈希"],
    stages: template.stages,
  }, agent);
  const brief = await store.createProjectBrief(workflow.id, {
    projectName: "验证样例",
    problemStatement: "手册缺少运行验证证据。",
    targetUsers: ["初级开发者"],
    primaryOutcome: "按手册完成可部署 MVP。",
    inScope: ["Web 主流程"],
    outOfScope: ["企业功能"],
    constraints: ["人工执行"],
    successCriteria: ["主路径通过"],
    targetPlatforms: ["Web"],
    preferredStack: ["Next.js App Router", "TypeScript", "PostgreSQL", "Playwright"],
  }, agent);
  const frozen = await store.freezeProjectBrief(workflow.id, { expectedRevision: brief.revision }, human);
  const draft = await store.createPlaybook(workflow.id, await compilePlaybookDraft({ workflow, projectBrief: frozen }), agent);
  const playbook = await store.confirmPlaybook(workflow.id, {
    expectedRevision: draft.revision,
    reviewedContentHash: draft.contentHash,
  }, human);
  return { store, workflow, playbook, agent, human, directory };
}

test("upgrades verification only through completed sample evidence and a novice validation record", async (context) => {
  const { store, workflow, playbook, agent, human, directory } = await confirmedPlaybook(context);
  let status = await store.getPlaybookVerification(workflow.id);
  assert.equal(status.currentLevel, "maintainer-reviewed");
  assert.equal(status.nextLevel, "sample-run");
  assert.equal(status.eligible, false);

  await assert.rejects(store.verifyPlaybook(workflow.id, {
    expectedRevision: playbook.revision,
    reviewedContentHash: playbook.contentHash,
    level: "sample-run",
    summary: "Agent 不能创建人工证据。",
    sampleName: "禁止样例",
    environment: "fixture",
    evidence: [{ kind: "note", value: "禁止" }],
  }, agent), /human-playbook-verification-required/);
  await assert.rejects(store.verifyPlaybook(workflow.id, {
    expectedRevision: playbook.revision,
    reviewedContentHash: playbook.contentHash,
    level: "sample-run",
    summary: "尚未执行。",
    sampleName: "未完成样例",
    environment: "fixture",
    evidence: [{ kind: "note", value: "没有完整进度" }],
  }, human), /playbook-sample-run-incomplete/);

  let progress = await store.startPlaybookProgress(workflow.id, human);
  for (const stage of playbook.stages) {
    for (const step of stage.steps) {
      progress = await store.updatePlaybookStepProgress(workflow.id, {
        expectedRevision: progress.revision,
        stageId: stage.id,
        stepId: step.id,
        status: "completed",
        acceptanceResult: "passed",
        notes: "按手册完成并人工验收。",
        evidence: [{ kind: "test-result", label: "步骤验收", value: `${step.title} 通过` }],
      }, human);
    }
    progress = await store.setPlaybookGateProgress(workflow.id, {
      expectedRevision: progress.revision,
      stageId: stage.id,
      status: "passed",
      rationale: "阶段产出、验收和证据均已核对。",
      evidence: [{ kind: "test-result", label: "质量门", value: `${stage.title} 通过` }],
    }, human);
  }
  status = await store.getPlaybookVerification(workflow.id);
  assert.equal(status.eligible, true);
  assert.equal(status.sampleRunReadiness.completedSteps, 18);
  assert.equal(status.sampleRunReadiness.passedGates, 9);

  await assert.rejects(store.verifyPlaybook(workflow.id, {
    expectedRevision: playbook.revision,
    reviewedContentHash: "stale-hash",
    level: "sample-run",
  }, human), /playbook-verification-hash-required/);
  const sample = await store.verifyPlaybook(workflow.id, {
    expectedRevision: playbook.revision,
    reviewedContentHash: playbook.contentHash,
    level: "sample-run",
    summary: "标准 Web MVP 从 Brief 到部署与复盘全部完成。",
    sampleName: "任务协作 MVP 标准样例",
    environment: "macOS，Node.js 26，PostgreSQL，Chromium",
    evidence: [
      { kind: "test-result", label: "验收报告", value: "18 步和 9 个质量门全部通过" },
      { kind: "link", label: "部署", value: "https://example.test/sample" },
    ],
  }, human);
  assert.equal(sample.playbook.verificationLevel, "sample-run");
  assert.equal(sample.playbook.contentHash, playbook.contentHash);
  assert.equal(sample.verification.progressRevision, progress.revision);

  await assert.rejects(store.verifyPlaybook(workflow.id, {
    expectedRevision: sample.playbook.revision,
    reviewedContentHash: playbook.contentHash,
    level: "novice-validated",
    summary: "需要大量代操作。",
    testerProfile: "具备基础终端和 Git 能力。",
    assistanceLevel: "substantial",
    evidence: [{ kind: "note", value: "观察记录" }],
  }, human), /playbook-verification-assistance-invalid/);
  const novice = await store.verifyPlaybook(workflow.id, {
    expectedRevision: sample.playbook.revision,
    reviewedContentHash: playbook.contentHash,
    level: "novice-validated",
    summary: "测试者仅在环境变量配置处获得一次提示，能够完成并解释主路径。",
    testerProfile: "具备基础编码、终端和 Git 能力，首次完成全栈项目生命周期。",
    assistanceLevel: "limited",
    evidence: [{ kind: "artifact", label: "观察记录", value: "匿名测试会话与完成清单" }],
  }, human);
  assert.equal(novice.playbook.verificationLevel, "novice-validated");
  status = await store.getPlaybookVerification(workflow.id);
  assert.equal(status.nextLevel, null);
  assert.equal(status.records.length, 2);
  assert.equal(status.records[1].previousVerificationId, status.records[0].id);

  const backup = await store.exportData();
  assert.equal(backup.playbookVerifications.length, 2);
  const restored = new WorkflowStore({ filePath: path.join(directory, "restored.json") });
  await restored.importData(backup, human);
  const restoredStatus = await restored.getPlaybookVerification(workflow.id);
  assert.equal(restoredStatus.currentLevel, "novice-validated");
  assert.equal(restoredStatus.records.length, 2);

  const revised = await store.updatePlaybook(workflow.id, {
    expectedRevision: novice.playbook.revision,
    patch: { summary: "内容变化后必须重新验证。" },
  }, agent);
  assert.equal(revised.status, "draft");
  assert.equal(revised.verificationLevel, "agent-generated");
  const stale = await store.getPlaybookVerification(workflow.id);
  assert.equal(stale.records.length, 0);
  assert.equal(stale.staleRecords.length, 2);
});
