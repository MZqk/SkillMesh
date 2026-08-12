import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const TEMPLATE_PATH = path.resolve(import.meta.dirname, "../data/web-skill-plan.json");

const DEPTH_STAGE_LIMITS = Object.freeze({
  quick: 3,
  standard: 5,
  full: 50,
});

const DEPTH_STAGE_LABELS = Object.freeze({
  quick: [
    ["定义", "澄清目标与边界"],
    ["交付", "完成最小可行结果"],
    ["验证", "验证结果并收尾"],
  ],
  standard: [
    ["探索", "明确方向与证据"],
    ["定义", "确定范围与方案"],
    ["实现", "交付端到端主路径"],
    ["验收", "验证质量与风险"],
    ["发布", "发布、观测与改进"],
  ],
});

let cachedTemplate = null;

function cleanText(value, maximum = 8_000) {
  return String(value || "").trim().slice(0, maximum);
}

function uniqueText(values, maximum = 100) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => cleanText(value, 1_000)).filter(Boolean))].slice(0, maximum);
}

function partitionStages(stages, targetCount) {
  if (stages.length <= targetCount) return stages.map((stage) => [stage]);
  if (stages.length === 9 && targetCount === 5) {
    return [[...stages.slice(0, 2)], [...stages.slice(2, 4)], [...stages.slice(4, 6)], [stages[6]], [...stages.slice(7, 9)]];
  }
  const groups = [];
  let offset = 0;
  for (let index = 0; index < targetCount; index += 1) {
    const remaining = stages.length - offset;
    const remainingGroups = targetCount - index;
    const size = Math.ceil(remaining / remainingGroups);
    groups.push(stages.slice(offset, offset + size));
    offset += size;
  }
  return groups.filter((group) => group.length);
}

function capabilityLabels(stages) {
  return new Map(stages.flatMap((stage) => (stage.capabilities || [])
    .map((capability) => [capability.id, capability.label || capability.id])));
}

function capabilityCriteria(stages, ids) {
  const wanted = new Set(ids);
  return uniqueText(stages.flatMap((stage) => (stage.capabilities || [])
    .filter((capability) => wanted.has(capability.id))
    .flatMap((capability) => capability.acceptanceCriteria || [])));
}

function fallbackStep(stage) {
  const requiredCapabilities = (stage.capabilities || []).filter((item) => item.required !== false).map((item) => item.id);
  return {
    id: `${stage.id}-skill-use`,
    order: 1,
    title: stage.title,
    objective: stage.description || stage.summary || `使用合适的 Skill 完成“${stage.title}”。`,
    requiredCapabilities,
    completionCriteria: uniqueText([
      ...capabilityCriteria([stage], requiredCapabilities),
      stage.acceptanceGate,
    ]).length
      ? uniqueText([...capabilityCriteria([stage], requiredCapabilities), stage.acceptanceGate])
      : [`“${stage.title}”所需能力已经完成，并能被后续阶段直接使用。`],
  };
}

function fullStageDefinitions(workflow, template) {
  const templateByStage = new Map((template.stages || []).map((stage) => [stage.id, stage]));
  return (workflow.stages || []).map((stage, stageIndex) => {
    const source = templateByStage.get(stage.id);
    const steps = source?.steps?.length
      ? source.steps.map((step, stepIndex) => ({
        id: step.id,
        order: stepIndex + 1,
        title: step.title,
        objective: step.objective,
        requiredCapabilities: uniqueText(step.requiredCapabilities),
        completionCriteria: uniqueText([
          ...(step.completionCriteria || []),
          ...capabilityCriteria([stage], step.requiredCapabilities || []),
        ]),
      }))
      : [fallbackStep(stage)];
    return {
      id: stage.id,
      order: stageIndex + 1,
      phase: stage.phase,
      title: stage.title,
      sourceStageIds: [stage.id],
      steps,
    };
  });
}

function condensedStageDefinitions(workflow, depth) {
  const groups = partitionStages(workflow.stages || [], DEPTH_STAGE_LIMITS[depth]);
  const labels = DEPTH_STAGE_LABELS[depth] || [];
  return groups.map((group, index) => {
    const [phase, title] = labels[index] || [group[0].phase, group.map((stage) => stage.title).join(" / ")];
    const requiredCapabilities = uniqueText(group.flatMap((stage) => (stage.capabilities || [])
      .filter((capability) => capability.required !== false)
      .map((capability) => capability.id)));
    const sourceTitles = group.map((stage) => stage.title);
    return {
      id: `${depth}-${index + 1}`,
      order: index + 1,
      phase,
      title,
      sourceStageIds: group.map((stage) => stage.id),
      steps: [{
        id: `${depth}-${index + 1}-skill-use`,
        order: 1,
        title: depth === "quick" ? title : `完成${title}`,
        objective: `按顺序完成“${sourceTitles.join("、")}”所需的 Skill 工作。`,
        requiredCapabilities,
        completionCriteria: uniqueText([
          ...capabilityCriteria(group, requiredCapabilities),
          ...group.map((stage) => stage.acceptanceGate),
        ]).length
          ? uniqueText([
            ...capabilityCriteria(group, requiredCapabilities),
            ...group.map((stage) => stage.acceptanceGate),
          ])
          : [`“${sourceTitles.join("、")}”所需能力已经完成。`],
      }],
    };
  });
}

function assessmentStages(assessment, sourceStageIds) {
  const wanted = new Set(sourceStageIds);
  return (assessment?.stages || []).filter((stage) => wanted.has(stage.id));
}

function aggregateCandidates(stages) {
  const byIdentity = new Map();
  for (const candidate of stages.flatMap((stage) => stage.candidates || [])) {
    const identity = candidate.contentHash || candidate.id || candidate.name;
    if (!identity) continue;
    const current = byIdentity.get(identity);
    if (!current) {
      byIdentity.set(identity, structuredClone(candidate));
      continue;
    }
    const scores = new Map((current.capabilityScores || []).map((score) => [score.capabilityId, score]));
    for (const score of candidate.capabilityScores || []) {
      const previous = scores.get(score.capabilityId);
      if (!previous || Number(score.score || 0) > Number(previous.score || 0)) scores.set(score.capabilityId, score);
    }
    current.capabilityScores = [...scores.values()];
    current.score = Math.max(Number(current.score || 0), Number(candidate.score || 0));
    current.confidence = Math.max(Number(current.confidence || 0), Number(candidate.confidence || 0));
    if (candidate.decision === "confirmed") current.decision = "confirmed";
    current.warnings = uniqueText([...(current.warnings || []), ...(candidate.warnings || [])]);
  }
  return [...byIdentity.values()];
}

function candidateMatches(candidate, requiredCapabilities) {
  const wanted = new Set(requiredCapabilities);
  return (candidate.capabilityScores || [])
    .filter((score) => wanted.has(score.capabilityId) && score.strength !== "none");
}

function candidatePriority(candidate, matches) {
  const confirmed = candidate.decision === "confirmed" ? 1 : 0;
  const strong = matches.filter((match) => match.strength === "strong").length;
  return confirmed * 10_000 + strong * 1_000 + (Number(candidate.score) || 0) * 100 + (Number(candidate.confidence) || 0);
}

function readiness(candidate, matches) {
  if (candidate.readiness === "human-verified") return "ready";
  if (candidate.readiness === "attention" || candidate.warnings?.length) return "attention";
  return matches.some((match) => match.strength === "strong") ? "unverified" : "attention";
}

function binding(candidate, matches, labels, role, step) {
  const responsibilityMatches = role === "primary"
    ? matches.filter((match) => match.strength === "strong")
    : matches;
  const responsibilities = uniqueText(responsibilityMatches.map((match) => labels.get(match.capabilityId) || match.capabilityId));
  const completionCriteria = uniqueText([
    ...responsibilities.map((label) => `完成“${label}”对应的工作。`),
    ...(step.completionCriteria || []),
  ]);
  const completionSentence = completionCriteria
    .map((item) => item.replace(/[。；;]+$/u, ""))
    .join("；");
  return {
    role,
    skillId: cleanText(candidate.id, 300),
    contentHash: cleanText(candidate.contentHash, 256),
    name: cleanText(candidate.name, 300) || "未命名 Skill",
    reviewStatus: role === "alternative" ? "suggested" : "confirmed",
    readiness: readiness(candidate, matches),
    providers: uniqueText(candidate.providers?.length ? candidate.providers : [candidate.provider]),
    supportedAgents: uniqueText(candidate.supportedAgents || []),
    rationale: `覆盖 ${responsibilities.join("、")}；综合匹配 ${Math.round((Number(candidate.score) || 0) * 100)}%。`,
    responsibilities,
    completionCriteria,
    invocationPrompt: `使用“${cleanText(candidate.name, 300)}”完成“${step.title}”，负责：${responsibilities.join("、")}。持续使用到以下条件全部满足：${completionSentence}。`,
  };
}

function externalCandidates(coverage) {
  return (coverage?.externalCandidates || [])
    .filter((candidate) => ["suggested", "accepted", "installed"].includes(candidate.status))
    .slice(0, 3)
    .map((candidate) => ({
      name: cleanText(candidate.skillName || candidate.packageId || candidate.sourceUrl, 500),
      status: candidate.status,
      source: "ecosystem",
    }));
}

function stepPlan({ definition, assessment, sourceStages, stage }) {
  const labels = capabilityLabels(sourceStages);
  const assessed = assessmentStages(assessment, stage.sourceStageIds);
  const candidates = aggregateCandidates(assessed);
  const coverages = assessed.flatMap((item) => item.capabilityCoverage || []);
  const ranked = candidates.map((candidate) => {
    const matches = candidateMatches(candidate, definition.requiredCapabilities);
    return { candidate, matches, priority: candidatePriority(candidate, matches) };
  }).filter((entry) => entry.matches.length)
    .sort((left, right) => right.priority - left.priority || String(left.candidate.name).localeCompare(String(right.candidate.name)));

  const primaryEntry = ranked.find((entry) => entry.candidate.decision === "confirmed"
    && entry.matches.some((match) => match.strength === "strong")) || null;
  const primaryStrong = new Set((primaryEntry?.matches || [])
    .filter((match) => match.strength === "strong")
    .map((match) => match.capabilityId));
  const supportingEntries = [];
  const uncoveredByPrimary = new Set(definition.requiredCapabilities.filter((capabilityId) => !primaryStrong.has(capabilityId)));
  for (const entry of ranked.filter((candidate) => candidate !== primaryEntry && candidate.candidate.decision === "confirmed")) {
    const newlyCovered = entry.matches.filter((match) => match.strength === "strong" && uncoveredByPrimary.has(match.capabilityId));
    if (!newlyCovered.length) continue;
    supportingEntries.push(entry);
    for (const match of newlyCovered) uncoveredByPrimary.delete(match.capabilityId);
  }
  const confirmedStrong = new Set([
    ...primaryStrong,
    ...supportingEntries.flatMap((entry) => entry.matches
      .filter((match) => match.strength === "strong")
      .map((match) => match.capabilityId)),
  ]);
  const alternatives = ranked.filter((entry) => entry !== primaryEntry
      && !supportingEntries.includes(entry)
      && entry.candidate.decision !== "confirmed")
    .slice(0, 2)
    .map((entry) => binding(entry.candidate, entry.matches, labels, "alternative", definition));
  const gaps = definition.requiredCapabilities.filter((capabilityId) => !confirmedStrong.has(capabilityId)).map((capabilityId) => {
    const coverage = coverages.find((item) => item.id === capabilityId);
    const matchingSuggestions = ranked
      .filter((entry) => entry !== primaryEntry
        && !supportingEntries.includes(entry)
        && entry.matches.some((match) => match.capabilityId === capabilityId))
      .slice(0, 3)
      .map((entry) => ({
        name: cleanText(entry.candidate.name, 300),
        status: entry.candidate.decision === "confirmed" ? "confirmed" : "suggested",
      }));
    return {
      stageId: stage.id,
      stageTitle: stage.title,
      sourceStageIds: stage.sourceStageIds,
      stepId: definition.id,
      stepTitle: definition.title,
      capabilityId,
      label: coverage?.label || labels.get(capabilityId) || capabilityId,
      status: coverage?.status === "missing" ? "missing" : "uncertain",
      candidates: [...new Map([...matchingSuggestions, ...externalCandidates(coverage)]
        .filter((item) => item.name)
        .map((item) => [item.name, item])).values()].slice(0, 3),
    };
  });
  return {
    card: primaryEntry ? {
      id: `${stage.id}:${definition.id}`,
      order: 0,
      stageId: stage.id,
      stageTitle: stage.title,
      sourceStageIds: stage.sourceStageIds,
      stepId: definition.id,
      stepTitle: definition.title,
      objective: definition.objective,
      primary: binding(primaryEntry.candidate, primaryEntry.matches, labels, "primary", definition),
      supportingSkills: supportingEntries.map((entry) => binding(entry.candidate, entry.matches, labels, "supporting", definition)),
      alternatives,
      completionCriteria: uniqueText(definition.completionCriteria),
      coverageGaps: gaps.map((gap) => ({ capabilityId: gap.capabilityId, label: gap.label, status: gap.status })),
    } : null,
    gaps,
  };
}

function capabilityEntries(assessment, stageId, capabilityId) {
  const stage = (assessment?.stages || []).find((item) => item.id === stageId);
  return (stage?.candidates || []).flatMap((candidate) => {
    const match = (candidate.capabilityScores || []).find((score) =>
      score.capabilityId === capabilityId && score.strength !== "none");
    return match ? [{ candidate, match }] : [];
  }).sort((left, right) => candidatePriority(right.candidate, [right.match])
    - candidatePriority(left.candidate, [left.match]));
}

function candidateHint(entry, status) {
  return {
    name: cleanText(entry.candidate.name, 300),
    contentHash: cleanText(entry.candidate.contentHash, 256),
    status,
    reviewStatus: entry.candidate.decision === "confirmed" ? "confirmed" : "suggested",
    evidenceStrength: entry.match.strength,
    providers: uniqueText(entry.candidate.providers?.length
      ? entry.candidate.providers
      : [entry.candidate.provider]),
    supportedAgents: uniqueText(entry.candidate.supportedAgents || []),
  };
}

function uniqueCandidateHints(values, maximum = 3) {
  return [...new Map(values.filter((item) => item.name)
    .map((item) => [item.contentHash || `${item.name}:${item.status}`, item])).values()].slice(0, maximum);
}

function coverageFor(assessment, stageId, capabilityId) {
  const stage = (assessment?.stages || []).find((item) => item.id === stageId);
  return (stage?.capabilityCoverage || []).find((item) => item.id === capabilityId);
}

function capabilityAvailability(workflow, targetAssessment, globalAssessment, targetAgent) {
  return (workflow.stages || []).flatMap((stage) => (stage.capabilities || [])
    .filter((capability) => capability.required !== false)
    .map((capability) => {
      const targetEntries = targetAgent.detected || targetAgent.current
        ? capabilityEntries(targetAssessment, stage.id, capability.id)
        : [];
      const targetReady = targetEntries.filter((entry) =>
        entry.candidate.decision === "confirmed" && entry.match.strength === "strong");
      const globalEntries = capabilityEntries(globalAssessment, stage.id, capability.id);
      const targetHashes = new Set(targetEntries.map((entry) => entry.candidate.contentHash).filter(Boolean));
      const otherReady = globalEntries.filter((entry) =>
        entry.candidate.decision === "confirmed"
        && entry.match.strength === "strong"
        && !targetHashes.has(entry.candidate.contentHash));
      const pending = uniqueCandidateHints([
        ...targetEntries.filter((entry) => !targetReady.includes(entry)).map((entry) => candidateHint(entry, "pending")),
        ...globalEntries.filter((entry) => !otherReady.includes(entry) && !targetHashes.has(entry.candidate.contentHash))
          .map((entry) => candidateHint(entry, "pending")),
      ]);
      const ecosystem = externalCandidates(coverageFor(targetAssessment, stage.id, capability.id)
        || coverageFor(globalAssessment, stage.id, capability.id));
      const status = targetReady.length
        ? "ready"
        : otherReady.length
          ? "other-agent"
          : pending.length
            ? "pending"
            : "ecosystem";
      const candidates = status === "ready"
        ? uniqueCandidateHints(targetReady.map((entry) => candidateHint(entry, "ready")))
        : status === "other-agent"
          ? uniqueCandidateHints(otherReady.map((entry) => candidateHint(entry, "other-agent")))
          : status === "pending"
            ? pending
            : ecosystem;
      return {
        targetAgent: targetAgent.id,
        stageId: stage.id,
        stageTitle: stage.title,
        capabilityId: capability.id,
        label: capability.label || capability.id,
        status,
        candidates,
      };
    }));
}

function availabilityCounts(items) {
  return Object.fromEntries(["ready", "other-agent", "pending", "ecosystem"]
    .map((status) => [status, items.filter((item) => item.status === status).length]));
}

function annotateGap(gap, availability) {
  const match = availability.find((item) => item.capabilityId === gap.capabilityId
    && gap.sourceStageIds.includes(item.stageId));
  if (!match) return gap;
  return {
    ...gap,
    targetAgent: match.targetAgent,
    availability: match.status,
    candidates: match.candidates,
  };
}

export function resolveSkillPlanDepth(workflow) {
  const riskLevel = workflow?.requirement?.riskLevel || "medium";
  if (["high", "critical"].includes(riskLevel)) return "full";
  if (riskLevel === "low" || (workflow?.stages || []).length <= 3) return "quick";
  return "standard";
}

export async function loadSkillPlanTemplate() {
  if (!cachedTemplate) cachedTemplate = JSON.parse(await fs.readFile(TEMPLATE_PATH, "utf8"));
  return structuredClone(cachedTemplate);
}

export function skillPlanContentHash(plan) {
  const content = {
    schemaVersion: plan.schemaVersion,
    workflowId: plan.workflowId,
    planningDepth: plan.planningDepth,
    source: {
      workflowRevision: plan.source?.workflowRevision,
      workflowReferenceId: plan.source?.workflowReferenceId,
      workflowReferenceVersion: plan.source?.workflowReferenceVersion,
      scoringVersion: plan.source?.scoringVersion,
    },
    mappingScope: plan.mappingScope,
    targetPlans: plan.targetPlans,
  };
  return crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

function compileTargetRoute({ workflow, assessment, globalAssessment, targetAgent, definitions }) {
  const sourceStagesById = new Map((workflow.stages || []).map((stage) => [stage.id, stage]));
  const availability = capabilityAvailability(workflow, assessment, globalAssessment, targetAgent);
  const rawGaps = [];
  let cardOrder = 0;
  const stages = definitions.map((stage) => {
    const sourceStages = stage.sourceStageIds.map((id) => sourceStagesById.get(id)).filter(Boolean);
    const cards = [];
    for (const step of stage.steps) {
      const result = stepPlan({ definition: step, assessment, sourceStages, stage });
      rawGaps.push(...result.gaps);
      if (result.card) cards.push({ ...result.card, order: ++cardOrder, targetAgent: targetAgent.id });
    }
    return {
      id: stage.id,
      order: stage.order,
      phase: stage.phase,
      title: stage.title,
      sourceStageIds: stage.sourceStageIds,
      cards,
    };
  });
  const gaps = rawGaps.map((gap) => annotateGap(gap, availability));
  const counts = availabilityCounts(availability);
  const trustedHashes = new Set(stages.flatMap((stage) => stage.cards.flatMap((card) => [
    card.primary?.contentHash,
    ...(card.supportingSkills || []).map((skill) => skill.contentHash),
  ])).filter(Boolean));
  return {
    targetAgent,
    summaryCounts: {
      requiredCapabilityCount: availability.length,
      readyCapabilityCount: counts.ready,
      otherAgentCount: counts["other-agent"],
      pendingCount: counts.pending,
      ecosystemGapCount: counts.ecosystem,
      cardCount: cardOrder,
      trustedSkillCount: trustedHashes.size,
      gapCount: availability.length - counts.ready,
      fullyCovered: availability.length > 0 && counts.ready === availability.length,
    },
    capabilityAvailability: availability,
    stages,
    gaps,
  };
}

export async function compileSkillUsagePlan({
  workflow,
  assessment,
  targetAssessments,
  globalAssessment = assessment,
  mappingScope,
}) {
  if (!workflow?.id) throw new Error("skill-plan-workflow-required");
  if (!assessment?.stages) throw new Error("skill-plan-assessment-required");
  const planningDepth = resolveSkillPlanDepth(workflow);
  const template = await loadSkillPlanTemplate();
  const definitions = planningDepth === "full"
    ? fullStageDefinitions(workflow, template)
    : condensedStageDefinitions(workflow, planningDepth);
  const legacyTarget = { id: "current", label: "当前 Agent", detected: true, current: true };
  const normalizedScope = mappingScope || {
    source: "current-host",
    currentAgent: legacyTarget.id,
    targetAgents: [legacyTarget],
  };
  const selectedAssessments = targetAssessments?.length
    ? targetAssessments
    : [{ targetAgent: normalizedScope.targetAgents?.[0] || legacyTarget, assessment }];
  const targetPlans = selectedAssessments.map((item) => compileTargetRoute({
    workflow,
    assessment: item.assessment,
    globalAssessment,
    targetAgent: item.targetAgent,
    definitions,
  }));
  const primaryTargetPlan = targetPlans.find((item) => item.targetAgent.id === normalizedScope.currentAgent)
    || targetPlans[0];
  const trustedHashes = new Set(targetPlans.flatMap((targetPlan) => targetPlan.stages
    .flatMap((stage) => stage.cards.flatMap((card) => [
      card.primary?.contentHash,
      ...(card.supportingSkills || []).map((skill) => skill.contentHash),
    ]))).filter(Boolean));
  const allAvailability = targetPlans.flatMap((targetPlan) => targetPlan.capabilityAvailability);
  const totalCounts = availabilityCounts(allAvailability);
  const gaps = targetPlans.flatMap((targetPlan) => targetPlan.gaps);
  const plan = {
    schemaVersion: "1",
    workflowId: workflow.id,
    title: `${workflow.goal}：Skill 使用方案`,
    summary: "按目标 Agent 独立测绘已就绪 Skill、其他 Agent 可同步能力、待确认证据和生态补充缺口。",
    planningDepth,
    generatedAt: new Date().toISOString(),
    mappingScope: {
      ...normalizedScope,
      allTargetsReady: targetPlans.length > 0 && targetPlans.every((item) => item.summaryCounts.fullyCovered),
    },
    source: {
      workflowRevision: workflow.revision,
      workflowReferenceId: workflow.reference?.id || workflow.id,
      workflowReferenceVersion: workflow.reference?.version || String(workflow.revision),
      inventoryGeneratedAt: assessment.generatedAt || null,
      scoringVersion: assessment.scoring?.version || "unknown",
    },
    summaryCounts: {
      targetCount: targetPlans.length,
      stageCount: primaryTargetPlan?.stages.length || 0,
      cardCount: targetPlans.reduce((sum, item) => sum + item.summaryCounts.cardCount, 0),
      trustedSkillCount: trustedHashes.size,
      requiredCapabilityCount: allAvailability.length,
      readyCapabilityCount: totalCounts.ready,
      otherAgentCount: totalCounts["other-agent"],
      pendingCount: totalCounts.pending,
      ecosystemGapCount: totalCounts.ecosystem,
      gapCount: allAvailability.length - totalCounts.ready,
      fullyCoveredTargetCount: targetPlans.filter((item) => item.summaryCounts.fullyCovered).length,
    },
    targetPlans,
    stages: primaryTargetPlan?.stages || [],
    gaps,
  };
  return { ...plan, contentHash: skillPlanContentHash(plan) };
}
