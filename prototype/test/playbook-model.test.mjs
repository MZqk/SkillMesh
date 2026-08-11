import assert from "node:assert/strict";
import test from "node:test";

import { loadWorkflowTemplate } from "../lib/matcher.mjs";
import { compilePlaybookDraft } from "../lib/playbook-compiler.mjs";
import { normalizePlaybookInput, playbookContentHash } from "../lib/playbook-model.mjs";
import { normalizeProjectBriefInput } from "../lib/project-brief-model.mjs";
import { normalizeWorkflowInput } from "../lib/workflow-model.mjs";

test("compiles the fixed nine-stage Web workflow into manual executable steps", async () => {
  const template = await loadWorkflowTemplate();
  const workflow = normalizeWorkflowInput({
    goal: "开发任务协作 Web 应用",
    reference: template,
    scopeDescription: "交付可部署 MVP。",
    nonGoals: ["不做企业 SSO"],
    acceptanceCriteria: ["主流程可在真实浏览器验收"],
    stages: template.stages,
  }, { id: "workflow-1", revision: 3 });
  const projectBrief = normalizeProjectBriefInput({
    projectName: "任务灯塔",
    problemStatement: "团队遗漏交接任务。",
    targetUsers: ["小团队"],
    primaryOutcome: "处理今日逾期任务。",
    inScope: ["任务主流程"],
    outOfScope: ["企业 SSO"],
    constraints: ["两周 MVP"],
    successCriteria: ["主流程验收通过"],
    targetPlatforms: ["Web"],
    preferredStack: [],
    status: "frozen",
    frozenVersion: 1,
  }, { id: "brief-1", workflowId: workflow.id, revision: 2 });
  const compiled = await compilePlaybookDraft({ workflow, projectBrief });
  const playbook = normalizePlaybookInput(compiled, { id: "playbook-1", workflowId: workflow.id });

  assert.equal(playbook.stages.length, 9);
  assert.equal(playbook.stages.reduce((total, stage) => total + stage.steps.length, 0), 18);
  assert.deepEqual(playbook.stages[0].steps[0].requiredCapabilities, ["discovery", "problem-framing"]);
  assert.equal(playbook.stages[0].mode, "vibe");
  assert.equal(playbook.stages[3].qualityGate.level, "soft");
  assert.equal(playbook.stages[4].mode, "loop");
  assert.equal(playbook.stages[8].qualityGate.level, "hard");
  assert.deepEqual(playbook.goldenStack, ["Next.js App Router", "TypeScript", "PostgreSQL", "Playwright"]);
  assert.equal(playbook.stages.every((stage) => stage.steps[0].execution.autoExecutionAllowed === false), true);
  assert.equal(playbook.stages.every((stage) => stage.steps[0].prompt.copyable === true), true);
  assert.match(playbook.stages[0].steps[0].prompt.text, /任务灯塔/);
  assert.equal(playbookContentHash(playbook).length, 64);

  const standard = normalizePlaybookInput(
    await compilePlaybookDraft({ workflow, projectBrief, depth: "auto" }),
    { id: "playbook-standard", workflowId: workflow.id },
  );
  assert.equal(standard.planningDepth, "standard");
  assert.equal(standard.stages.length, 5);
  assert.equal(standard.stages.reduce((total, stage) => total + stage.steps.length, 0), 5);

  const quick = normalizePlaybookInput(
    await compilePlaybookDraft({ workflow, projectBrief, depth: "quick" }),
    { id: "playbook-quick", workflowId: workflow.id },
  );
  assert.equal(quick.planningDepth, "quick");
  assert.equal(quick.stages.length, 3);
  assert.deepEqual(quick.stages.map((stage) => stage.dependencies.length), [0, 1, 1]);
});

test("rejects a required stage that is not an executable, recoverable unit", () => {
  assert.throws(() => normalizePlaybookInput({
    title: "不完整手册",
    source: { projectBriefVersion: 1 },
    stages: [{
      id: "define",
      title: "定义",
      steps: [{
        title: "只写标题",
        objective: "定义范围",
        actions: ["开始"],
        prompt: "请定义范围",
        expectedOutputs: ["范围"],
        acceptanceCriteria: ["范围明确"],
        failureModes: [],
      }],
      qualityGate: { criteria: ["范围明确"] },
    }],
  }, { workflowId: "workflow-1" }), /playbook-step-failure-recovery-required/);
});
