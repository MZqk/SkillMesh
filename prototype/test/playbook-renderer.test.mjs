import assert from "node:assert/strict";
import test from "node:test";

import { loadWorkflowTemplate } from "../lib/matcher.mjs";
import { compilePlaybookDraft } from "../lib/playbook-compiler.mjs";
import { normalizePlaybookInput, publicPlaybook } from "../lib/playbook-model.mjs";
import { renderPlaybookMarkdown } from "../lib/playbook-renderer.mjs";
import { normalizeProjectBriefInput } from "../lib/project-brief-model.mjs";
import { normalizeWorkflowInput } from "../lib/workflow-model.mjs";

test("renders the exact Playbook source and content hash as a junior-readable Markdown handbook", async () => {
  const template = await loadWorkflowTemplate();
  const workflow = normalizeWorkflowInput({
    goal: "开发任务协作 Web 应用",
    reference: template,
    scopeDescription: "帮助小团队处理逾期任务。",
    nonGoals: ["不做企业 SSO"],
    acceptanceCriteria: ["主路径在浏览器通过"],
    stages: template.stages,
  }, { id: "workflow-render", revision: 2 });
  const projectBrief = normalizeProjectBriefInput({
    projectName: "任务灯塔",
    problemStatement: "团队遗漏交接任务。",
    targetUsers: ["小团队负责人"],
    primaryOutcome: "处理今日逾期任务。",
    inScope: ["任务主流程"],
    outOfScope: ["企业 SSO"],
    constraints: ["两周 MVP"],
    successCriteria: ["主流程验收通过"],
    targetPlatforms: ["Web"],
    preferredStack: ["Next.js App Router", "TypeScript", "PostgreSQL", "Playwright"],
    status: "frozen",
    frozenVersion: 1,
  }, { id: "brief-render", workflowId: workflow.id, revision: 2 });
  const input = await compilePlaybookDraft({ workflow, projectBrief });
  const playbook = normalizePlaybookInput(input, { id: "playbook-render", workflowId: workflow.id });
  const publicView = publicPlaybook(playbook);
  const markdown = renderPlaybookMarkdown({ playbook, projectBrief });

  assert.match(markdown, /^# 任务灯塔：从 0 到 1 开发手册/m);
  assert.match(markdown, new RegExp(publicView.contentHash));
  assert.match(markdown, /## 阶段 1：把方向变成问题/);
  assert.match(markdown, /## 阶段 9：从真实使用中学习/);
  assert.match(markdown, /### 1\. 写清首个用户与真实问题/);
  assert.match(markdown, /Capability Atlas 不会自动运行 Skill、命令或修改项目/);
  assert.match(markdown, /### 本阶段 Skill 执行地图/);
  assert.match(markdown, /### 进入下一阶段的条件/);
  assert.match(markdown, /#### Skill 执行要求/);
  assert.ok(markdown.indexOf("#### Skill 执行要求") < markdown.indexOf("#### 操作"));
  assert.match(markdown, /待进行步骤级 Skill 匹配/);
});
