import crypto from "node:crypto";

export const PROJECT_BRIEF_SCHEMA_VERSION = "1";

const LIMITS = {
  text: 4_000,
  listItems: 100,
};

function text(value, maximum = LIMITS.text) {
  return String(value || "").trim().slice(0, maximum);
}

function stringList(value, { maximum = LIMITS.listItems, itemMaximum = 500 } = {}) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, itemMaximum)).filter(Boolean))].slice(0, maximum);
}

function normalizeDeliveryTarget(value) {
  const allowed = new Set(["local-prototype", "deployable-mvp", "production-ready"]);
  return allowed.has(value) ? value : "deployable-mvp";
}

function inferredPlatforms(requirement, goal) {
  const explicit = stringList(requirement.targetPlatforms, { maximum: 20, itemMaximum: 100 });
  if (explicit.length) return explicit;
  const signal = `${requirement.taskType || ""} ${goal || ""} ${(requirement.preferredStack || []).join(" ")}`.toLowerCase();
  if (/android|安卓|kotlin|compose/.test(signal)) return ["Android"];
  if (/ios|iphone|ipad|swiftui/.test(signal)) return ["iOS"];
  if (/macos|mac app|桌面应用/.test(signal)) return ["macOS"];
  if (/\bweb\b|网页|网站|next\.js|react|vue|浏览器/.test(signal)) return ["Web"];
  return ["当前工作环境"];
}

export function seedProjectBrief(workflow) {
  const requirement = workflow?.requirement || {};
  const goal = text(workflow?.goal, 2_000) || "完成当前工作流目标";
  const desiredOutputs = stringList(requirement.desiredOutputs);
  const acceptanceCriteria = stringList(workflow?.acceptanceCriteria);
  const targetUsers = stringList(requirement.targetUsers, { maximum: 50, itemMaximum: 300 });
  const nonGoals = stringList(workflow?.nonGoals);
  const constraints = stringList(requirement.constraints);
  const preferredStack = stringList(requirement.preferredStack, { maximum: 50, itemMaximum: 100 });
  const assumptions = [];
  if (!targetUsers.length) assumptions.push("目标用户由工作流目标自动推断，锁定执行基线前可修改。");
  if (!desiredOutputs.length) assumptions.push("首版范围由工作流目标自动推断，锁定执行基线前可修改。");
  if (!preferredStack.length) assumptions.push("技术栈默认沿用当前项目，锁定执行基线前可修改。");
  return {
    sourceGoal: goal,
    projectName: text(goal, 300),
    problemStatement: text(workflow?.scopeDescription || goal),
    targetUsers: targetUsers.length ? targetUsers : [`需要完成“${goal}”的首要用户`],
    primaryOutcome: text(desiredOutputs[0] || acceptanceCriteria[0] || `完成“${goal}”并获得可验收结果`),
    inScope: desiredOutputs.length ? desiredOutputs : [`完成“${goal}”的最小可行主路径`],
    outOfScope: nonGoals.length ? nonGoals : ["当前工作流未明确列出的扩展能力"],
    constraints: constraints.length ? constraints : ["无额外约束"],
    successCriteria: acceptanceCriteria.length ? acceptanceCriteria : [`“${goal}”的主路径可以完成并通过验收`],
    targetPlatforms: inferredPlatforms(requirement, goal),
    preferredStack: preferredStack.length ? preferredStack : ["沿用当前项目技术栈"],
    assumptions,
    openQuestions: [],
    deploymentTarget: "deployable-mvp",
  };
}

export function normalizeProjectBriefInput(value, {
  id = crypto.randomUUID(),
  workflowId,
  revision = 1,
  timestamps = {},
} = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("project-brief-object-required");
  }
  const resolvedWorkflowId = text(workflowId || value.workflowId, 200);
  if (!resolvedWorkflowId) throw new Error("project-brief-workflow-required");
  const createdAt = timestamps.createdAt || new Date().toISOString();
  const updatedAt = timestamps.updatedAt || createdAt;
  return {
    schemaVersion: PROJECT_BRIEF_SCHEMA_VERSION,
    id: text(id || value.id, 200),
    workflowId: resolvedWorkflowId,
    sourceGoal: text(value.sourceGoal, 2_000),
    projectName: text(value.projectName, 300),
    problemStatement: text(value.problemStatement),
    targetUsers: stringList(value.targetUsers, { maximum: 50, itemMaximum: 300 }),
    primaryOutcome: text(value.primaryOutcome),
    inScope: stringList(value.inScope),
    outOfScope: stringList(value.outOfScope),
    constraints: stringList(value.constraints),
    successCriteria: stringList(value.successCriteria),
    targetPlatforms: stringList(value.targetPlatforms, { maximum: 20, itemMaximum: 100 }),
    preferredStack: stringList(value.preferredStack, { maximum: 50, itemMaximum: 100 }),
    assumptions: stringList(value.assumptions),
    openQuestions: stringList(value.openQuestions),
    deploymentTarget: normalizeDeliveryTarget(value.deploymentTarget),
    status: value.status === "frozen" ? "frozen" : "draft",
    revision: Math.max(1, Number(revision) || 1),
    frozenVersion: Math.max(0, Number(value.frozenVersion) || 0),
    baseFrozenVersion: Math.max(0, Number(value.baseFrozenVersion) || 0),
    createdAt,
    updatedAt,
    createdBy: structuredClone(value.createdBy || null),
    updatedBy: structuredClone(value.updatedBy || null),
    frozenAt: value.frozenAt ? text(value.frozenAt, 100) : null,
    frozenBy: value.frozenBy ? structuredClone(value.frozenBy) : null,
  };
}

const REQUIRED_FIELDS = [
  ["projectName", "项目名称", "给这个项目一个便于识别的名称。"],
  ["problemStatement", "问题陈述", "请说明目标用户在什么场景遇到什么问题，以及为什么值得现在解决。"],
  ["targetUsers", "目标用户", "谁会最先使用它？请给出至少一类明确用户。"],
  ["primaryOutcome", "首要结果", "用户完成主路径后，必须获得什么可观察结果？"],
  ["inScope", "首版范围", "首个可部署 MVP 明确包含哪些能力？"],
  ["outOfScope", "非目标", "哪些能力明确不进入首版，以防范围失控？"],
  ["constraints", "项目约束", "列出时间、预算、合规、数据或运行环境约束；若没有，请明确写“无额外约束”。"],
  ["successCriteria", "成功标准", "用哪些可观察、可验收的结果判断 MVP 成功？"],
  ["targetPlatforms", "目标平台", "首版运行在哪个平台？例如 Web。"],
  ["preferredStack", "技术栈", "确认首选技术栈；Web 黄金路径建议 Next.js App Router、TypeScript、PostgreSQL、Playwright。"],
];

function hasValue(value) {
  return Array.isArray(value) ? value.length > 0 : Boolean(text(value));
}

export function projectBriefCompleteness(brief) {
  const missing = REQUIRED_FIELDS.filter(([field]) => !hasValue(brief?.[field]));
  const questions = missing.map(([field, label, prompt]) => ({
    id: `brief-${field}`,
    field,
    label,
    prompt,
  }));
  const completed = REQUIRED_FIELDS.length - missing.length;
  return {
    complete: missing.length === 0,
    completed,
    required: REQUIRED_FIELDS.length,
    score: Number((completed / REQUIRED_FIELDS.length).toFixed(2)),
    missingFields: missing.map(([field]) => field),
    questions,
    nextQuestion: questions[0] || null,
  };
}

export function assertProjectBriefFreezable(brief) {
  const completeness = projectBriefCompleteness(brief);
  if (!completeness.complete) {
    throw new Error(`project-brief-not-freezable:${completeness.missingFields.join(",")}`);
  }
}

export function projectBriefContentHash(brief) {
  const content = {
    sourceGoal: text(brief?.sourceGoal, 2_000),
    projectName: text(brief?.projectName, 300),
    problemStatement: text(brief?.problemStatement),
    targetUsers: stringList(brief?.targetUsers, { maximum: 50, itemMaximum: 300 }),
    primaryOutcome: text(brief?.primaryOutcome),
    inScope: stringList(brief?.inScope),
    outOfScope: stringList(brief?.outOfScope),
    constraints: stringList(brief?.constraints),
    successCriteria: stringList(brief?.successCriteria),
    targetPlatforms: stringList(brief?.targetPlatforms, { maximum: 20, itemMaximum: 100 }),
    preferredStack: stringList(brief?.preferredStack, { maximum: 50, itemMaximum: 100 }),
    assumptions: stringList(brief?.assumptions),
    openQuestions: stringList(brief?.openQuestions),
    deploymentTarget: normalizeDeliveryTarget(brief?.deploymentTarget),
  };
  return crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export function publicProjectBrief(brief, { includeCompleteness = true } = {}) {
  const result = structuredClone(brief);
  if (includeCompleteness) result.completeness = projectBriefCompleteness(brief);
  result.contentHash = projectBriefContentHash(brief);
  return result;
}
