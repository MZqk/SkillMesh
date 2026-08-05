import assert from "node:assert/strict";
import test from "node:test";

import { candidateActionLabels } from "../public/candidate-action-labels.js";

// Regression test added by /qa for ISSUE-001.
test("candidate actions expose the Skill name to assistive technology", () => {
  const grilling = candidateActionLabels("grilling", "confirmed", "agent-skills", "user");
  const grillMe = candidateActionLabels("grill-me", "unreviewed", "workbuddy", "user");
  const grillingFromWorkBuddy = candidateActionLabels("grilling", "unreviewed", "workbuddy", "user");

  assert.equal(grilling.inspect, "查看 grilling（agent-skills · user） 详情");
  assert.equal(grilling.confirm, "取消确认 grilling（agent-skills · user）");
  assert.equal(grilling.install, "将 grilling（agent-skills · user） 加入安装计划");
  assert.equal(grillMe.copy, "复制 grill-me（workbuddy · user） 路径");
  assert.equal(grillMe.confirm, "确认 grill-me（workbuddy · user） 匹配");
  assert.notEqual(grilling.inspect, grillMe.inspect);
  assert.notEqual(grilling.inspect, grillingFromWorkBuddy.inspect);
});
