import assert from "node:assert/strict";
import test from "node:test";

import {
  missingWorkflowConfirmationFields,
  parseWorkflowListInput,
  workflowConfirmationState,
} from "../public/workflow-confirmation.js";

test("requires confirmation metadata independently of Skill decisions", () => {
  const workflow = {
    status: "draft",
    reviews: { stage: { skill: { decision: "confirmed" } } },
    scopeDescription: "",
    nonGoals: [],
    acceptanceCriteria: [],
  };

  assert.deepEqual(missingWorkflowConfirmationFields(workflow), ["包含范围", "明确不做", "验收标准"]);
  assert.equal(workflowConfirmationState(workflow).canConfirm, false);
});

test("enables confirmation only for a complete unconfirmed draft", () => {
  const workflow = {
    status: "draft",
    scopeDescription: "覆盖从需求到发布的 Android 应用交付。",
    nonGoals: ["不负责运营后台"],
    acceptanceCriteria: ["应用可在真机运行"],
  };

  assert.deepEqual(missingWorkflowConfirmationFields(workflow), []);
  assert.equal(workflowConfirmationState(workflow).canConfirm, true);
  assert.equal(workflowConfirmationState(workflow, { busy: true }).canConfirm, false);
  assert.equal(workflowConfirmationState({ ...workflow, status: "confirmed" }).canConfirm, false);
});

test("parses one list item per line without blanks or duplicates", () => {
  assert.deepEqual(parseWorkflowListInput(" 第一项 \n\n第二项\r\n第一项 "), ["第一项", "第二项"]);
});
