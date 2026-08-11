import fs from "node:fs/promises";
import path from "node:path";

import { canonicalSkills } from "./skill-identity.mjs";

const TEMPLATE_PATHS = {
  web: path.resolve(import.meta.dirname, "../data/web-product-workflow.json"),
  android: path.resolve(import.meta.dirname, "../data/android-product-workflow.json"),
  generic: path.resolve(import.meta.dirname, "../data/generic-delivery-workflow.json"),
};

const GENERIC_TERMS = new Set([
  "analysis", "build", "design", "development", "implementation", "plan", "planning", "quality",
  "requirements", "research", "review", "security", "skill", "test", "testing", "validate", "workflow",
  "分析", "开发", "构建", "规划", "计划", "技能", "测试", "研究", "设计", "需求", "验证", "质量",
]);

const PLATFORM_SIGNALS = {
  android: ["android", "kotlin", "jetpack", "compose", "gradle", "安卓"],
  web: ["web", "website", "frontend", "html", "css", "react", "vue", "网页", "网站", "前端"],
  ios: ["ios", "swift", "swiftui", "xcode", "iphone", "ipad"],
  macos: ["macos", "appkit", "swiftui", "xcode", "mac app"],
};

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^\p{L}\p{N}+#.-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return [...new Set(normalize(value).split(" ").filter((term) =>
    term.length > 1 && !GENERIC_TERMS.has(term)))];
}

function round(value, digits = 3) {
  return Number(Math.max(0, Math.min(1, Number(value) || 0)).toFixed(digits));
}

function indexTerm(term) {
  const normalized = normalize(term);
  const parts = normalized.split(" ").filter(Boolean);
  const generic = parts.length === 1 && GENERIC_TERMS.has(normalized);
  const specificity = generic ? 0.42 : parts.length > 1 ? 1 : normalized.length >= 8 ? 0.94 : 0.72;
  return {
    value: String(term || ""),
    normalized,
    short: /^[a-z0-9+#.-]{1,3}$/i.test(normalized),
    specificity,
  };
}

function indexSkill(skill) {
  const definitions = [
    ["name", skill.name, 1],
    ["description", skill.description, 0.82],
    ["keywords", (skill.keywords || []).join(" "), 0.82],
    ["triggers", (skill.triggers || []).join(" "), 0.78],
    ["body", skill.searchText, 0.38],
  ];
  const fields = definitions.map(([name, value, weight]) => {
    const normalized = normalize(value);
    return { name, value, weight, normalized, tokens: new Set(normalized.split(" ")) };
  });
  return {
    skill,
    fields,
    summaryTokens: new Set(tokenize(`${skill.name || ""} ${skill.description || ""} ${(skill.keywords || []).join(" ")}`)),
    corpus: normalize(`${skill.name || ""} ${skill.description || ""} ${(skill.keywords || []).join(" ")} ${skill.searchText || ""}`),
  };
}

function compatibleWithAgents(skill, targetAgents) {
  if (!targetAgents.length) return true;
  const declared = (skill.supportedAgents || []).map((agent) => String(agent || "").trim());
  if (!declared.length || declared.includes("*")) return true;
  const supported = declared.map(normalize);
  return targetAgents.some((target) => supported.includes(normalize(target)));
}

function containsTerm(field, term) {
  if (!term.normalized) return false;
  return term.short ? field.tokens.has(term.normalized) : field.normalized.includes(term.normalized);
}

function excerpt(value, term, radius = 56) {
  const source = String(value || "").replace(/\s+/g, " ").trim();
  if (!source) return "";
  const index = normalize(source).indexOf(normalize(term));
  if (index < 0) return source.slice(0, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + String(term).length + radius);
  return `${start > 0 ? "…" : ""}${source.slice(start, end)}${end < source.length ? "…" : ""}`;
}

function evidenceFor(indexedSkill, capability) {
  const hits = [];
  for (const term of capability.indexedTerms) {
    let best = null;
    for (const field of indexedSkill.fields) {
      if (!containsTerm(field, term)) continue;
      const hit = {
        capabilityId: capability.id,
        capability: capability.label,
        term: term.value,
        field: field.name,
        fieldWeight: field.weight,
        specificity: term.specificity,
        strengthScore: field.weight * term.specificity,
        sourceValue: field.value,
      };
      if (!best || hit.strengthScore > best.strengthScore) best = hit;
    }
    if (best) hits.push(best);
  }
  hits.sort((left, right) => right.strengthScore - left.strengthScore);
  const unique = hits.filter((hit, index) => hits.findIndex((other) => other.term === hit.term) === index);
  const score = unique.length
    ? Math.min(1, unique[0].strengthScore + unique.slice(1, 4).reduce((sum, hit) => sum + hit.strengthScore * 0.16, 0))
    : 0;
  return { score, hits: unique.slice(0, 5) };
}

function overlapScore(expectedTokens, actualTokens) {
  if (!expectedTokens.length) return 0.7;
  const hits = expectedTokens.filter((term) => actualTokens.has(term)).length;
  return Math.min(1, hits / Math.max(1, Math.min(expectedTokens.length, 5)));
}

function platformScore(indexedSkill, targetPlatforms) {
  if (!targetPlatforms.length) return 0.7;
  const normalizedTargets = targetPlatforms.map(normalize);
  let best = 0;
  let conflictingPlatform = false;
  for (const [platform, signals] of Object.entries(PLATFORM_SIGNALS)) {
    const hasSignal = signals.some((signal) => indexedSkill.corpus.includes(normalize(signal)));
    if (!hasSignal) continue;
    const isTarget = normalizedTargets.some((target) => target.includes(platform)
      || signals.some((signal) => target.includes(normalize(signal))));
    if (isTarget) best = 1;
    else conflictingPlatform = true;
  }
  if (best) return best;
  return conflictingPlatform ? 0.15 : 0.5;
}

function stackScore(indexedSkill, preferredStack) {
  if (!preferredStack.length) return 0.7;
  const matches = preferredStack.filter((item) => indexedSkill.corpus.includes(normalize(item))).length;
  return matches ? Math.min(1, 0.7 + matches * 0.15) : 0.35;
}

function acceptanceScore(indexedSkill, capability, workflowAcceptanceCriteria) {
  const terms = tokenize([
    ...(capability.acceptanceCriteria || []),
    ...(workflowAcceptanceCriteria || []),
  ].join(" "));
  return terms.length ? overlapScore(terms, indexedSkill.summaryTokens) : 0.7;
}

function qualityScore(skill) {
  let score = 0.72;
  if (skill.metadataStatus === "complete") score += 0.12;
  else score -= 0.18;
  if (skill.sourceKind === "direct") score += 0.08;
  else score -= 0.08;
  if (skill.version) score += 0.03;
  if (skill.license) score += 0.03;
  if (skill.identity?.nameConflict) score -= 0.16;
  return round(score);
}

function readinessFor(skill, validations) {
  const validation = validations[skill.contentHash];
  if (validation?.status === "human-verified") return { label: "human-verified", score: 1, validation };
  let score = 0.5;
  if (skill.sourceKind === "direct") score += 0.08;
  if (skill.metadataStatus === "complete") score += 0.04;
  if (skill.identity?.nameConflict) score -= 0.12;
  return { label: score < 0.5 ? "attention" : "unverified", score: round(score), validation: null };
}

function nonGoalPenalty(indexedSkill, nonGoals) {
  const terms = tokenize((nonGoals || []).join(" "));
  if (!terms.length) return 1;
  const matches = terms.filter((term) => indexedSkill.summaryTokens.has(term)).length;
  return matches ? Math.max(0.55, 1 - matches * 0.12) : 1;
}

function scoreCapability(indexedSkill, capability, context, validations) {
  const evidence = evidenceFor(indexedSkill, capability);
  const contextualTokens = tokenize([
    context.goal,
    context.scopeDescription,
    capability.label,
    capability.description || "",
    context.requirement.taskType || "",
    ...(context.requirement.targetPlatforms || []),
    ...(context.requirement.targetUsers || []),
    ...(context.requirement.preferredStack || []),
    ...(context.requirement.constraints || []),
    ...(context.requirement.desiredOutputs || []),
  ].join(" "));
  const task = overlapScore(contextualTokens, indexedSkill.summaryTokens);
  const acceptance = acceptanceScore(indexedSkill, capability, context.acceptanceCriteria);
  const platform = platformScore(indexedSkill, context.requirement.targetPlatforms || []);
  const stack = stackScore(indexedSkill, context.requirement.preferredStack || []);
  const quality = qualityScore(indexedSkill.skill);
  const readiness = readinessFor(indexedSkill.skill, validations);
  const penalty = nonGoalPenalty(indexedSkill, context.nonGoals);
  const fit = (evidence.score * 0.6 + task * 0.12 + acceptance * 0.08 + platform * 0.12 + stack * 0.08) * penalty;
  const confidence = evidence.hits.length
    ? Math.min(1, evidence.hits[0].fieldWeight * evidence.hits[0].specificity
      + Math.min(0.12, (evidence.hits.length - 1) * 0.04)) * (0.8 + quality * 0.2)
    : 0;
  const strong = evidence.score >= 0.62
    && fit >= 0.52
    && (evidence.hits[0]?.fieldWeight || 0) >= 0.78;
  const weak = !strong && (evidence.score >= 0.2 || fit >= 0.34);
  return {
    capabilityId: capability.id,
    fitScore: round(fit),
    evidenceScore: round(evidence.score),
    taskScore: round(task),
    acceptanceScore: round(acceptance),
    platformScore: round(platform),
    stackScore: round(stack),
    qualityScore: quality,
    readinessScore: readiness.score,
    readiness: readiness.label,
    validation: readiness.validation,
    confidence: round(confidence),
    strong,
    weak,
    evidence: evidence.hits,
  };
}

function decisionFor(overrides, skill) {
  return overrides[skill.contentHash] || overrides[skill.id] || "";
}

function warningsFor(skill) {
  const warnings = [];
  if (skill.metadataStatus === "incomplete") warnings.push("元数据不完整");
  if (skill.identity?.nameConflict) warnings.push("同名不同内容");
  if (skill.identity?.duplicateContent) warnings.push("存在内容副本");
  if (skill.sourceKind === "derived") warnings.push("来自缓存或内置派生目录");
  return warnings;
}

function candidateView(aggregate, validations, suggestions) {
  const { skill, capabilityScores } = aggregate;
  const warnings = warningsFor(skill);
  const readiness = readinessFor(skill, validations);
  const strongCapabilities = capabilityScores.filter((item) => item.strong).map((item) => item.capabilityId);
  const weakCapabilities = capabilityScores.filter((item) => item.weak).map((item) => item.capabilityId);
  const requiredTotal = Math.max(1, aggregate.requiredTotal);
  const requiredIds = new Set(aggregate.requiredCapabilityIds || []);
  const coveredRequired = strongCapabilities.filter((capabilityId) => requiredIds.has(capabilityId));
  const coverageScore = coveredRequired.length / requiredTotal;
  const fitScore = Math.max(0, ...capabilityScores.map((item) => item.fitScore));
  const confidence = Math.max(0, ...capabilityScores.map((item) => item.confidence));
  const quality = qualityScore(skill);
  const composite = fitScore * 0.5 + Math.min(1, coverageScore) * 0.25 + readiness.score * 0.1 + quality * 0.1 + confidence * 0.05;
  const optimization = warnings.map((warning) => ({
    "元数据不完整": "补齐标准 name 与 description 元数据",
    "同名不同内容": "明确版本或重命名，避免 Agent 选择错误内容",
    "存在内容副本": "合并或标注权威副本，减少漂移",
    "来自缓存或内置派生目录": "改用直接安装的可维护来源",
  }[warning])).filter(Boolean);
  return {
    id: skill.contentHash || skill.id,
    instanceId: skill.id,
    name: skill.name,
    description: skill.description || "未提供 description",
    provider: skill.provider,
    providers: skill.providers || [skill.provider],
    scope: skill.scope,
    sourceKind: skill.sourceKind,
    supportedAgents: skill.supportedAgents || [],
    packageId: skill.packageId || "",
    path: skill.path,
    realPath: skill.realPath,
    contentHash: skill.contentHash,
    score: round(composite),
    fitScore: round(fitScore),
    coverageScore: round(coverageScore),
    readinessScore: round(readiness.score),
    qualityScore: quality,
    confidence: round(confidence),
    decision: aggregate.decision || "unreviewed",
    readiness: readiness.label,
    validation: readiness.validation,
    optimization,
    agentSuggestions: suggestions.filter((item) => item.skillContentHash === skill.contentHash),
    capabilityScores: capabilityScores.map((item) => ({
      capabilityId: item.capabilityId,
      fitScore: item.fitScore,
      evidenceScore: item.evidenceScore,
      taskScore: item.taskScore,
      acceptanceScore: item.acceptanceScore,
      platformScore: item.platformScore,
      stackScore: item.stackScore,
      confidence: item.confidence,
      strength: item.strong ? "strong" : item.weak ? "weak" : "none",
    })),
    evidence: capabilityScores.flatMap((item) => item.evidence.slice(0, 3).map((evidence) => ({
      capabilityId: item.capabilityId,
      capability: evidence.capability,
      term: evidence.term,
      field: evidence.field,
      strength: item.strong ? "strong" : "weak",
      untrusted: evidence.field === "body",
      excerpt: excerpt(evidence.sourceValue, evidence.term),
    }))),
    warnings,
  };
}

function stageStatus({ strongCoverage, weakCoverage, confirmedCoverage, confirmedCandidates }) {
  if (confirmedCoverage >= 0.999) return "complete";
  if (strongCoverage > 0 || confirmedCandidates > 0) return "partial";
  if (weakCoverage > 0) return "uncertain";
  return "missing";
}

function reasonFor(status, matched, total, confirmedMatched, confirmedCandidates) {
  const coverageText = `${matched}/${total} 项必需能力有可靠文本证据`;
  if (status === "complete") return `${coverageText}，且 ${confirmedMatched}/${total} 项已有人工确认的对应 Skill。`;
  if (status === "partial" && confirmedCandidates && !matched) return "存在人工选择的候选，但尚无文本证据证明其覆盖必需能力；需补充说明或验证。";
  if (status === "partial") return `${coverageText}；仍需补齐缺口并完成运行验证或人工确认。`;
  if (status === "uncertain") return "只发现弱相关证据；正文命中或宽泛词命中不能视为能力已覆盖。";
  return "没有找到达到最低证据门槛的本机 Skill；这表示可复用资产缺口，不代表模型绝对无法执行。";
}

async function readTemplate(kind) {
  return JSON.parse(await fs.readFile(TEMPLATE_PATHS[kind], "utf8"));
}

export async function loadWorkflowTemplate() {
  return readTemplate("web");
}

export async function loadWorkflowTemplateForRequirement({ goal = "", scopeDescription = "", requirement = {} } = {}) {
  const corpus = normalize([
    goal,
    scopeDescription,
    requirement.taskType,
    ...(requirement.targetPlatforms || []),
    ...(requirement.preferredStack || []),
  ].join(" "));
  if (/(android|安卓|jetpack compose|kotlin)/i.test(corpus)) return readTemplate("android");
  if (/(web|website|网页|网站|saas|react|vue|前端)/i.test(corpus)) return readTemplate("web");
  return readTemplate("generic");
}

export async function buildPlan({
  goal,
  inventory,
  overrides = {},
  workflow: workflowInput,
  validations = {},
  suggestions = [],
  externalCandidates = [],
  targetAgent = "",
}) {
  const workflow = workflowInput || await loadWorkflowTemplateForRequirement({ goal });
  const trimmedGoal = String(goal || workflow.goal || "交付一个可验证结果").trim();
  const requirement = workflow.requirement || {};
  const targetAgents = [...new Set([targetAgent, ...(requirement.targetAgents || [])].filter(Boolean))];
  const context = {
    goal: trimmedGoal,
    scopeDescription: workflow.scopeDescription || workflow.description || "",
    requirement,
    nonGoals: workflow.nonGoals || [],
    acceptanceCriteria: workflow.acceptanceCriteria || [],
  };
  const availableSkills = canonicalSkills(inventory.skills)
    .filter((skill) => skill.enabled !== false)
    .filter((skill) => compatibleWithAgents(skill, targetAgents));
  const indexedSkills = availableSkills.map(indexSkill);

  const stages = workflow.stages.map((stage) => {
    const nodeOverrides = overrides[stage.id] || {};
    const capabilities = stage.capabilities.map((capability) => ({
      ...capability,
      required: capability.required !== false,
      indexedTerms: [...new Set([
        ...(capability.terms || []),
        capability.label,
        capability.description || "",
      ].filter(Boolean))].map(indexTerm),
    }));
    const requiredCapabilities = capabilities.filter((capability) => capability.required);
    const coverageCapabilities = requiredCapabilities.length ? requiredCapabilities : capabilities;
    const allByCapability = new Map();
    const bySkill = new Map();

    for (const capability of capabilities) {
      const scored = indexedSkills
        .filter(({ skill }) => decisionFor(nodeOverrides, skill) !== "excluded")
        .map((indexedSkill) => ({
          indexedSkill,
          result: scoreCapability(indexedSkill, capability, context, validations),
          decision: decisionFor(nodeOverrides, indexedSkill.skill),
        }))
        .filter((item) => item.result.strong || item.result.weak || item.decision === "confirmed")
        .sort((left, right) => {
          if (left.decision === "confirmed" && right.decision !== "confirmed") return -1;
          if (right.decision === "confirmed" && left.decision !== "confirmed") return 1;
          return right.result.fitScore - left.result.fitScore
            || right.result.confidence - left.result.confidence
            || left.indexedSkill.skill.name.localeCompare(right.indexedSkill.skill.name);
        });
      allByCapability.set(capability.id, scored);
      for (const item of scored) {
        const key = item.indexedSkill.skill.contentHash || item.indexedSkill.skill.id;
        const aggregate = bySkill.get(key) || {
          skill: item.indexedSkill.skill,
          decision: item.decision,
          requiredTotal: coverageCapabilities.length,
          requiredCapabilityIds: coverageCapabilities.map((capability) => capability.id),
          capabilityScores: [],
        };
        aggregate.capabilityScores.push(item.result);
        if (item.decision) aggregate.decision = item.decision;
        bySkill.set(key, aggregate);
      }
    }

    // Preserve at least one representative for each capability, then fill by
    // composite score. Coverage calculation itself uses every scored result.
    const representativeKeys = [];
    for (const capability of capabilities) {
      const top = allByCapability.get(capability.id)?.[0];
      if (top) representativeKeys.push(top.indexedSkill.skill.contentHash || top.indexedSkill.skill.id);
    }
    const candidateViews = [...bySkill.entries()].map(([key, aggregate]) => [key, candidateView(aggregate, validations, suggestions)]);
    const byKeyView = new Map(candidateViews);
    const selectedKeys = [...new Set(representativeKeys)].slice(0, 8);
    for (const [key, view] of candidateViews.sort((left, right) => right[1].score - left[1].score)) {
      if (selectedKeys.length >= 8) break;
      if (!selectedKeys.includes(key)) selectedKeys.push(key);
    }
    const candidates = selectedKeys.map((key) => byKeyView.get(key)).filter(Boolean);

    const capabilityCoverage = capabilities.map((capability) => {
      const records = allByCapability.get(capability.id) || [];
      const strongCandidates = records.filter((item) => item.result.strong);
      const weakCandidates = records.filter((item) => item.result.weak);
      const confirmedCandidates = strongCandidates.filter((item) => item.decision === "confirmed");
      const linkedExternal = externalCandidates.filter((item) =>
        item.stageId === stage.id && (!item.capabilityId || item.capabilityId === capability.id));
      const status = confirmedCandidates.length
        ? "confirmed"
        : strongCandidates.length
          ? "evidenced"
          : weakCandidates.length
            ? "uncertain"
            : "missing";
      const top = strongCandidates[0] || weakCandidates[0];
      return {
        id: capability.id,
        label: capability.label,
        required: capability.required,
        status,
        candidateCount: strongCandidates.length || weakCandidates.length,
        bestFitScore: top?.result.fitScore || 0,
        confidence: top?.result.confidence || 0,
        recommendation: status === "missing"
          ? linkedExternal.length ? "review-external-candidates" : "find-external-or-create"
          : status === "uncertain"
            ? "review-or-optimize"
            : status === "evidenced"
              ? "runtime-validate-and-review"
              : "none",
        gapQuery: status === "missing"
          ? [...new Set([capability.label, ...(capability.terms || []).slice(0, 4), ...(requirement.targetPlatforms || [])])].join(" ")
          : "",
        externalCandidates: linkedExternal,
        agentSuggestions: suggestions.filter((item) => item.capabilityId === capability.id),
      };
    });

    const covered = capabilityCoverage.filter((item) => item.required && ["evidenced", "confirmed"].includes(item.status));
    const weak = capabilityCoverage.filter((item) => item.required && item.status === "uncertain");
    const confirmedCoverageItems = capabilityCoverage.filter((item) => item.required && item.status === "confirmed");
    const denominator = Math.max(1, coverageCapabilities.length);
    const strongCoverage = covered.length / denominator;
    const weakCoverage = (covered.length + weak.length) / denominator;
    const confirmedCoverage = confirmedCoverageItems.length / denominator;
    const confirmedCandidates = candidates.filter((candidate) => candidate.decision === "confirmed").length;
    const status = stageStatus({ strongCoverage, weakCoverage, confirmedCoverage, confirmedCandidates });
    const bestRecords = coverageCapabilities.map((capability) => {
      const records = allByCapability.get(capability.id) || [];
      return records.find((item) => item.result.strong) || records.find((item) => item.result.weak);
    }).filter(Boolean);
    const average = (field) => bestRecords.length
      ? bestRecords.reduce((sum, item) => sum + item.result[field], 0) / denominator
      : 0;
    const matchScore = average("fitScore");
    const readinessScore = average("readinessScore");
    const quality = average("qualityScore");
    const confidence = bestRecords.length
      ? (average("confidence") * (0.55 + strongCoverage * 0.45))
      : 0;

    return {
      ...stage,
      status,
      matchScore: round(matchScore),
      matchPercent: Math.round(matchScore * 100),
      readinessScore: round(readinessScore),
      qualityScore: round(quality),
      confidence: round(confidence, 2),
      coverage: {
        matched: covered.length,
        confirmed: confirmedCoverageItems.length,
        total: coverageCapabilities.length,
        ratio: round(strongCoverage, 2),
        confirmedRatio: round(confirmedCoverage, 2),
      },
      capabilityCoverage,
      reason: reasonFor(status, covered.length, coverageCapabilities.length, confirmedCoverageItems.length, confirmedCandidates),
      candidates,
      excludedCount: Object.values(nodeOverrides).filter((value) => value === "excluded").length,
      review: { confirmedCapabilities: confirmedCoverageItems.length, totalCapabilities: coverageCapabilities.length },
    };
  });

  const counts = Object.fromEntries(["complete", "partial", "uncertain", "missing"].map((status) => [
    status,
    stages.filter((stage) => stage.status === status).length,
  ]));
  const totalRequired = stages.reduce((sum, stage) => sum + stage.coverage.total, 0);
  const weighted = (field) => totalRequired
    ? stages.reduce((sum, stage) => sum + stage[field] * stage.coverage.total, 0) / totalRequired
    : 0;

  return {
    schemaVersion: "0.2",
    generatedAt: new Date().toISOString(),
    goal: trimmedGoal,
    template: {
      id: workflow.id,
      name: workflow.name,
      version: workflow.version,
      referenceType: workflow.referenceType,
      description: workflow.description,
    },
    assumptions: workflowInput
      ? [
          `当前使用“${workflow.name}”的结构化阶段与能力项，不额外假定固定行业流程。`,
          workflow.referenceType === "human-confirmed"
            ? "当前工作流定义来自人工确认版本；Skill 映射仍需按当前内容指纹复核。"
            : "当前工作流仍是 Agent/用户草案，不能当作人工确认事实。",
          "本图评估可复用的本机 Skill，不把通用模型临时完成任务视为资产覆盖。",
          "匹配读取名称、description、声明字段与正文文本，但不执行脚本或 Skill 指令。",
        ]
      : [
          `已根据目标选择“${workflow.name}”参考模板；可由 Agent 或用户继续裁剪。`,
          "本图评估可复用的本机 Skill，不把通用模型临时完成任务视为资产覆盖。",
          "匹配读取名称、description、声明字段与正文文本，但不执行脚本或 Skill 指令。",
        ],
    scoring: {
      version: "lexical-evidence-v2",
      dimensions: ["fitScore", "coverageScore", "readinessScore", "qualityScore", "confidence"],
      note: "分数是可解释的检索启发式，不是能力成功率；正文弱命中、未验证安装与人工确认分别展示。",
    },
    summary: {
      stages: stages.length,
      counts,
      matchScore: round(weighted("matchScore")),
      matchPercent: Math.round(weighted("matchScore") * 100),
      // Kept for API compatibility. This is lexical evidence coverage, not
      // proof that a Skill was reviewed or succeeded at runtime.
      coverageRatio: round(totalRequired ? stages.reduce((sum, stage) => sum + stage.coverage.matched, 0) / totalRequired : 0),
      evidencedCoverageRatio: round(totalRequired ? stages.reduce((sum, stage) => sum + stage.coverage.matched, 0) / totalRequired : 0),
      confirmedCoverageRatio: round(totalRequired ? stages.reduce((sum, stage) => sum + stage.coverage.confirmed, 0) / totalRequired : 0),
      readinessScore: round(weighted("readinessScore")),
      qualityScore: round(weighted("qualityScore")),
      confidence: round(weighted("confidence")),
      missingRequiredCapabilities: stages.reduce((sum, stage) => sum
        + stage.capabilityCoverage.filter((item) => item.required && item.status === "missing").length, 0),
      unconfirmedRequiredCapabilities: stages.reduce((sum, stage) => sum
        + stage.capabilityCoverage.filter((item) => item.required && ["evidenced", "uncertain"].includes(item.status)).length, 0),
      reviewedCandidates: Object.values(overrides).reduce((total, decisions) => total + Object.keys(decisions || {}).length, 0),
      inventoryPaths: inventory.stats.paths,
      inventoryUniqueContent: inventory.stats.uniqueContent,
      eligibleUniqueContent: availableSkills.length,
      disabledOrIncompatible: canonicalSkills(inventory.skills).length - availableSkills.length,
      externalCandidates: externalCandidates.length,
    },
    stages,
  };
}
