import assert from "node:assert/strict";
import test from "node:test";

import { planToMarkdown } from "../lib/exporter.mjs";
import { buildPlan } from "../lib/matcher.mjs";

test("exports decisions, evidence boundary, and the full lifecycle", async () => {
  const plan = await buildPlan({
    goal: "开发一个 Web 应用",
    inventory: { stats: { paths: 0, uniqueContent: 0 }, skills: [] },
  });
  const markdown = planToMarkdown(plan);

  assert.match(markdown, /^# 技能地图：开发一个 Web 应用/m);
  assert.match(markdown, /### 1\. 把方向变成问题/);
  assert.match(markdown, /### 9\. 从真实使用中学习/);
  assert.match(markdown, /能力：用户与问题研究（需要补齐）/);
  assert.match(markdown, /文本证据覆盖：0%/);
  assert.match(markdown, /人工确认覆盖：0%/);
  assert.match(markdown, /不会安装、执行或修改任何 Skill/);
});
