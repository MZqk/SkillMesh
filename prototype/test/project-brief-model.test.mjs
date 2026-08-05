import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProjectBriefFreezable,
  normalizeProjectBriefInput,
  projectBriefCompleteness,
  seedProjectBrief,
} from "../lib/project-brief-model.mjs";

test("seeds a structured Project Brief and asks the next missing interview question", () => {
  const seed = seedProjectBrief({
    goal: "开发一个团队任务 Web 应用",
    scopeDescription: "减少小团队遗漏交接任务的问题。",
    requirement: {
      targetPlatforms: ["Web"],
      targetUsers: ["5 至 20 人的小团队"],
      preferredStack: ["Next.js App Router", "TypeScript"],
      desiredOutputs: ["可部署 MVP"],
      constraints: [],
    },
    nonGoals: ["不做企业级权限中心"],
    acceptanceCriteria: ["用户可以创建并完成任务"],
  });
  const brief = normalizeProjectBriefInput(seed, { workflowId: "workflow-1" });
  const completeness = projectBriefCompleteness(brief);

  assert.equal(brief.deploymentTarget, "deployable-mvp");
  assert.equal(completeness.complete, false);
  assert.deepEqual(completeness.missingFields, ["constraints"]);
  assert.equal(completeness.nextQuestion.field, "constraints");
  assert.throws(() => assertProjectBriefFreezable(brief), /project-brief-not-freezable:constraints/);
});

test("accepts a complete Brief as a human-freezable generation contract", () => {
  const brief = normalizeProjectBriefInput({
    sourceGoal: "开发 Web 应用",
    projectName: "任务灯塔",
    problemStatement: "小团队无法及时发现逾期交接任务。",
    targetUsers: ["小团队负责人"],
    primaryOutcome: "负责人能看见并处理今日逾期任务。",
    inScope: ["任务创建", "逾期列表"],
    outOfScope: ["企业级 SSO"],
    constraints: ["两周内完成 MVP"],
    successCriteria: ["主流程通过浏览器验收"],
    targetPlatforms: ["Web"],
    preferredStack: ["Next.js App Router", "TypeScript", "PostgreSQL", "Playwright"],
  }, { workflowId: "workflow-1" });

  assert.doesNotThrow(() => assertProjectBriefFreezable(brief));
  assert.deepEqual(projectBriefCompleteness(brief), {
    complete: true,
    completed: 10,
    required: 10,
    score: 1,
    missingFields: [],
    questions: [],
    nextQuestion: null,
  });
});
