function roundPercent(value) {
  return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100);
}

function candidateMatches(candidate, capabilityIds) {
  return (candidate.capabilityScores || [])
    .filter((score) => capabilityIds.includes(score.capabilityId) && score.strength !== "none");
}

function candidatePriority(candidate, matches) {
  const confirmed = candidate.decision === "confirmed" ? 1 : 0;
  const strong = matches.filter((item) => item.strength === "strong").length;
  return confirmed * 10_000 + strong * 1_000 + (candidate.score || 0) * 100 + (candidate.confidence || 0);
}

function readinessFor(candidate, matches) {
  if (candidate.readiness === "human-verified") return "ready";
  if (candidate.readiness === "attention" || candidate.warnings?.length) return "attention";
  if (!matches.some((item) => item.strength === "strong")) return "attention";
  return "unverified";
}

function bindingFor(candidate, matches, capabilityLabels, role, step) {
  const labels = matches.map((match) => capabilityLabels.get(match.capabilityId) || match.capabilityId);
  const strength = matches.some((match) => match.strength === "strong") ? "强证据" : "弱证据";
  const decision = candidate.decision === "confirmed" ? "，已人工确认映射" : "，尚未人工确认映射";
  const responsibilities = [...new Set(labels)];
  const completionCriteria = [...new Set([
    ...responsibilities.map((label) => `完成“${label}”能力对应的本步骤工作，不遗留给下一阶段猜测。`),
    ...(step.acceptanceCriteria || []),
  ])];
  const requiredEvidence = [...new Set(step.evidenceRequirements || [])];
  return {
    role,
    skillId: candidate.id,
    contentHash: candidate.contentHash,
    name: candidate.name,
    rationale: `覆盖 ${labels.join("、")}；${strength}；综合匹配 ${roundPercent(candidate.score)}%${decision}。`,
    readiness: readinessFor(candidate, matches),
    reviewStatus: candidate.decision === "confirmed" ? "confirmed" : "suggested",
    usageLevel: role === "primary" ? "required" : "fallback",
    responsibilities,
    completionCriteria,
    requiredEvidence,
    invocationPrompt: `调用“${candidate.name}”Skill 完成步骤“${step.title}”，负责：${responsibilities.join("、")}。必须持续使用到以下条件全部满足：${completionCriteria.join("；")}。返回产出与证据，不要把文本匹配描述为运行验证。`,
    humanFallback: "若该 Skill 不可用、未验证或不适配，忽略其指令，直接按本步骤的操作、验收标准与失败恢复路径人工完成。",
  };
}

function gapFor(capabilityId, coverage, capabilityLabels, step) {
  const external = (coverage?.externalCandidates || [])
    .filter((item) => ["suggested", "accepted", "installed"].includes(item.status))
    .slice(0, 3)
    .map((item) => ({
      name: item.skillName || item.packageId || item.sourceUrl,
      packageId: item.packageId || "",
      sourceUrl: item.sourceUrl || "",
      status: item.status,
    }));
  return {
    capabilityId,
    label: coverage?.label || capabilityLabels.get(capabilityId) || capabilityId,
    status: coverage?.status === "uncertain" ? "uncertain" : "missing",
    query: coverage?.gapQuery || capabilityLabels.get(capabilityId) || capabilityId,
    externalCandidates: external,
    humanFallback: `当前没有足够证据证明本机 Skill 覆盖此能力。继续时按“${step.title}”的操作与验收标准人工完成，并记录需要补齐或创建的 Skill。`,
  };
}

export function bindSkillsToPlaybook({ playbook, assessment }) {
  if (!playbook?.stages || !assessment?.stages) throw new Error("playbook-skill-assessment-required");
  const assessmentByStage = new Map(assessment.stages.map((stage) => [stage.id, stage]));
  const result = structuredClone(playbook);
  result.stages = result.stages.map((stage) => {
    const assessedStage = assessmentByStage.get(stage.id);
    const capabilityLabels = new Map((assessedStage?.capabilityCoverage || [])
      .map((capability) => [capability.id, capability.label]));
    return {
      ...stage,
      steps: stage.steps.map((step) => {
        const required = step.requiredCapabilities || [];
        const ranked = (assessedStage?.candidates || []).map((candidate) => {
          const matches = candidateMatches(candidate, required);
          return { candidate, matches, priority: candidatePriority(candidate, matches) };
        }).filter((item) => item.matches.length)
          .sort((left, right) => right.priority - left.priority);
        const strong = ranked.filter((item) => item.matches.some((match) => match.strength === "strong"));
        const primary = strong[0] || null;
        const alternatives = ranked.filter((item) => item !== primary).slice(0, primary ? 2 : 3);
        const bindings = [
          ...(primary ? [bindingFor(primary.candidate, primary.matches, capabilityLabels, "primary", step)] : []),
          ...alternatives.map((item) => bindingFor(item.candidate, item.matches, capabilityLabels, "alternative", step)),
        ];
        const stronglyCovered = new Set(primary?.matches
          .filter((match) => match.strength === "strong")
          .map((match) => match.capabilityId) || []);
        for (const alternative of alternatives) {
          for (const match of alternative.matches.filter((item) => item.strength === "strong")) {
            stronglyCovered.add(match.capabilityId);
          }
        }
        const gaps = required.filter((capabilityId) => !stronglyCovered.has(capabilityId)).map((capabilityId) => {
          const coverage = assessedStage?.capabilityCoverage?.find((item) => item.id === capabilityId);
          return gapFor(capabilityId, coverage, capabilityLabels, step);
        });
        return {
          ...step,
          skillBindings: bindings,
          skillGaps: gaps,
        };
      }),
    };
  });
  result.skillBindingAssessment = {
    schemaVersion: assessment.schemaVersion,
    generatedAt: assessment.generatedAt,
    scoringVersion: assessment.scoring?.version || "unknown",
    workflowRevision: assessment.workflow?.revision || playbook.source?.workflowRevision || 0,
    inventoryUniqueContent: assessment.summary?.inventoryUniqueContent || 0,
    note: "Skill 绑定来自可解释文本证据与人工映射；不等同于运行成功或初级开发者验证。",
  };
  return result;
}
