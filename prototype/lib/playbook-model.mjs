import crypto from "node:crypto";

export const PLAYBOOK_SCHEMA_VERSION = "1";

const LIMITS = {
  stages: 20,
  stepsPerStage: 50,
  listItems: 100,
  text: 8_000,
};

function text(value, maximum = LIMITS.text) {
  return String(value || "").trim().slice(0, maximum);
}

function identifier(value, fallbackPrefix = "item") {
  const normalized = text(value, 200)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return normalized || `${fallbackPrefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function stringList(value, { maximum = LIMITS.listItems, itemMaximum = 1_000 } = {}) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, itemMaximum)).filter(Boolean))].slice(0, maximum);
}

function normalizeSkillBindings(value) {
  if (!Array.isArray(value)) return [];
  const allowedRoles = new Set(["primary", "alternative"]);
  const allowedReadiness = new Set(["ready", "attention", "unverified", "missing"]);
  return value.slice(0, 20).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const name = text(item.name, 300);
    if (!name) return [];
    return [{
      role: allowedRoles.has(item.role) ? item.role : "alternative",
      skillId: text(item.skillId, 200) || null,
      contentHash: text(item.contentHash, 200) || null,
      name,
      rationale: text(item.rationale, 2_000),
      readiness: allowedReadiness.has(item.readiness) ? item.readiness : "unverified",
      reviewStatus: item.reviewStatus === "confirmed" ? "confirmed" : "suggested",
      usageLevel: item.usageLevel === "required" ? "required" : "fallback",
      responsibilities: stringList(item.responsibilities, { maximum: 50, itemMaximum: 500 }),
      completionCriteria: stringList(item.completionCriteria, { maximum: 100, itemMaximum: 1_000 }),
      requiredEvidence: stringList(item.requiredEvidence, { maximum: 100, itemMaximum: 1_000 }),
      invocationPrompt: text(item.invocationPrompt, 4_000),
      humanFallback: text(item.humanFallback, 2_000),
    }];
  });
}

function normalizeSkillGaps(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const capabilityId = identifier(item.capabilityId || item.label, "capability");
    const label = text(item.label, 300) || capabilityId;
    return [{
      capabilityId,
      label,
      status: item.status === "uncertain" ? "uncertain" : "missing",
      query: text(item.query, 1_000),
      externalCandidates: Array.isArray(item.externalCandidates) ? item.externalCandidates.slice(0, 10).flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
        const name = text(candidate.name, 300);
        if (!name) return [];
        return [{
          name,
          packageId: text(candidate.packageId, 500),
          sourceUrl: text(candidate.sourceUrl, 1_000),
          status: ["suggested", "accepted", "installed"].includes(candidate.status) ? candidate.status : "suggested",
        }];
      }) : [],
      humanFallback: text(item.humanFallback, 2_000),
    }];
  });
}

function normalizeSkillBindingAssessment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    schemaVersion: text(value.schemaVersion, 100),
    generatedAt: text(value.generatedAt, 100),
    scoringVersion: text(value.scoringVersion, 100),
    workflowRevision: Math.max(0, Number(value.workflowRevision) || 0),
    inventoryUniqueContent: Math.max(0, Number(value.inventoryUniqueContent) || 0),
    note: text(value.note, 2_000),
  };
}

function normalizeFailureModes(value, stepId) {
  if (!Array.isArray(value) || !value.length) throw new Error(`playbook-step-failure-recovery-required:${stepId}`);
  return value.slice(0, 20).map((item, index) => {
    const source = typeof item === "string" ? { symptom: item } : item;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error(`invalid-playbook-failure-mode:${stepId}:${index + 1}`);
    }
    const symptom = text(source.symptom, 1_000);
    const recovery = text(source.recovery, 2_000);
    if (!symptom || !recovery) throw new Error(`playbook-step-failure-recovery-required:${stepId}`);
    return {
      symptom,
      likelyCause: text(source.likelyCause, 1_000),
      recovery,
    };
  });
}

function normalizeExecution(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    mode: "manual",
    executor: null,
    autoExecutionAllowed: false,
    approvalPolicy: ["none", "human-before-action", "human-at-gate"].includes(source.approvalPolicy)
      ? source.approvalPolicy
      : "human-at-gate",
    evidenceFields: stringList(source.evidenceFields, { maximum: 20, itemMaximum: 200 }),
  };
}

function normalizeStep(value, stageId, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid-playbook-step:${stageId}:${index + 1}`);
  }
  const id = identifier(value.id || value.title, `step-${index + 1}`);
  const title = text(value.title, 300);
  const objective = text(value.objective, 2_000);
  const actions = stringList(value.actions);
  const prompt = text(typeof value.prompt === "object" ? value.prompt?.text : value.prompt, 8_000);
  const commands = stringList(value.commands, { maximum: 50, itemMaximum: 2_000 });
  const expectedOutputs = stringList(value.expectedOutputs);
  const acceptanceCriteria = stringList(value.acceptanceCriteria);
  if (!title) throw new Error(`playbook-step-title-required:${stageId}:${id}`);
  if (!objective) throw new Error(`playbook-step-objective-required:${stageId}:${id}`);
  if (!actions.length) throw new Error(`playbook-step-actions-required:${stageId}:${id}`);
  if (!prompt && !commands.length) throw new Error(`playbook-step-invocation-required:${stageId}:${id}`);
  if (!expectedOutputs.length) throw new Error(`playbook-step-outputs-required:${stageId}:${id}`);
  if (!acceptanceCriteria.length) throw new Error(`playbook-step-acceptance-required:${stageId}:${id}`);
  return {
    id,
    order: index + 1,
    title,
    objective,
    requiredCapabilities: stringList(value.requiredCapabilities, { maximum: 50, itemMaximum: 200 }).map((item) => identifier(item)),
    prerequisites: stringList(value.prerequisites),
    actions,
    prompt: {
      text: prompt,
      copyable: value.prompt?.copyable !== false,
    },
    commands,
    expectedOutputs,
    acceptanceCriteria,
    failureModes: normalizeFailureModes(value.failureModes, id),
    evidenceRequirements: stringList(value.evidenceRequirements),
    skillBindings: normalizeSkillBindings(value.skillBindings),
    skillGaps: normalizeSkillGaps(value.skillGaps),
    execution: normalizeExecution(value.execution),
  };
}

function normalizeQualityGate(value, stageId) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const level = source.level === "hard" ? "hard" : "soft";
  const criteria = stringList(source.criteria);
  if (!criteria.length) throw new Error(`playbook-quality-gate-required:${stageId}`);
  return {
    level,
    criteria,
    requiredEvidence: stringList(source.requiredEvidence),
  };
}

function normalizeStages(value) {
  if (!Array.isArray(value) || !value.length) throw new Error("playbook-stages-required");
  const ids = new Set();
  return value.slice(0, LIMITS.stages).map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`invalid-playbook-stage:${index + 1}`);
    }
    const id = identifier(item.id || item.title, `stage-${index + 1}`);
    if (ids.has(id)) throw new Error(`duplicate-playbook-stage-id:${id}`);
    ids.add(id);
    const title = text(item.title, 300);
    if (!title) throw new Error(`playbook-stage-title-required:${id}`);
    const applicability = item.applicability === "not-applicable" ? "not-applicable" : "required";
    const applicabilityReason = text(item.applicabilityReason, 2_000);
    if (applicability === "not-applicable" && !applicabilityReason) {
      throw new Error(`playbook-stage-na-reason-required:${id}`);
    }
    const steps = Array.isArray(item.steps)
      ? item.steps.slice(0, LIMITS.stepsPerStage).map((step, stepIndex) => normalizeStep(step, id, stepIndex))
      : [];
    if (applicability === "required" && !steps.length) throw new Error(`playbook-stage-steps-required:${id}`);
    const dependencies = stringList(item.dependencies, { maximum: LIMITS.stages, itemMaximum: 100 }).map((entry) => identifier(entry));
    return {
      id,
      order: index + 1,
      phase: text(item.phase, 120) || `阶段 ${index + 1}`,
      title,
      summary: text(item.summary, 2_000),
      mode: item.mode === "loop" ? "loop" : "vibe",
      applicability,
      applicabilityReason,
      minimumAssessment: text(item.minimumAssessment, 2_000),
      dependencies,
      steps,
      qualityGate: normalizeQualityGate(item.qualityGate, id),
    };
  }).map((stage, index, stages) => {
    const preceding = new Set(stages.slice(0, index).map((item) => item.id));
    for (const dependency of stage.dependencies) {
      if (!preceding.has(dependency)) throw new Error(`playbook-stage-dependency-must-precede:${stage.id}:${dependency}`);
    }
    return stage;
  });
}

function normalizeSource(value, workflowId) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const briefSnapshot = source.projectBriefSnapshot
    && typeof source.projectBriefSnapshot === "object"
    && !Array.isArray(source.projectBriefSnapshot)
    ? structuredClone(source.projectBriefSnapshot)
    : null;
  return {
    workflowId,
    workflowRevision: Math.max(1, Number(source.workflowRevision) || 1),
    workflowReferenceId: text(source.workflowReferenceId, 200),
    workflowReferenceVersion: text(source.workflowReferenceVersion, 100),
    projectBriefId: text(source.projectBriefId, 200),
    projectBriefVersion: Math.max(0, Number(source.projectBriefVersion) || 0),
    projectBriefRevision: Math.max(1, Number(source.projectBriefRevision) || 1),
    projectBriefStatus: source.projectBriefStatus === "frozen" ? "frozen" : "draft",
    projectBriefContentHash: text(source.projectBriefContentHash, 200).toLowerCase(),
    projectBriefSnapshot: briefSnapshot,
    templateId: text(source.templateId, 200) || "web-product-playbook",
    templateVersion: text(source.templateVersion, 100) || "0.1.0",
    templateContentHash: text(source.templateContentHash, 200),
  };
}

export function normalizePlaybookInput(value, {
  id = crypto.randomUUID(),
  workflowId,
  revision = 1,
  timestamps = {},
} = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("playbook-object-required");
  const resolvedWorkflowId = text(workflowId || value.workflowId || value.source?.workflowId, 200);
  if (!resolvedWorkflowId) throw new Error("playbook-workflow-required");
  const title = text(value.title, 500);
  if (!title) throw new Error("playbook-title-required");
  const createdAt = timestamps.createdAt || new Date().toISOString();
  const updatedAt = timestamps.updatedAt || createdAt;
  const allowedVerification = new Set(["agent-generated", "maintainer-reviewed", "sample-run", "novice-validated"]);
  return {
    schemaVersion: PLAYBOOK_SCHEMA_VERSION,
    id: text(id || value.id, 200),
    workflowId: resolvedWorkflowId,
    title,
    summary: text(value.summary, 4_000),
    audience: text(value.audience, 2_000),
    deliveryTarget: ["local-prototype", "deployable-mvp", "production-ready"].includes(value.deliveryTarget)
      ? value.deliveryTarget
      : "deployable-mvp",
    planningDepth: ["quick", "standard", "full"].includes(value.planningDepth)
      ? value.planningDepth
      : "full",
    goldenStack: stringList(value.goldenStack, { maximum: 50, itemMaximum: 200 }),
    source: normalizeSource(value.source, resolvedWorkflowId),
    skillBindingAssessment: normalizeSkillBindingAssessment(value.skillBindingAssessment),
    stages: normalizeStages(value.stages),
    verificationLevel: allowedVerification.has(value.verificationLevel)
      ? value.verificationLevel
      : "agent-generated",
    status: value.status === "confirmed" ? "confirmed" : "draft",
    revision: Math.max(1, Number(revision) || 1),
    confirmedVersion: Math.max(0, Number(value.confirmedVersion) || 0),
    baseConfirmationVersion: Math.max(0, Number(value.baseConfirmationVersion) || 0),
    createdAt,
    updatedAt,
    createdBy: structuredClone(value.createdBy || null),
    updatedBy: structuredClone(value.updatedBy || null),
    confirmedAt: value.confirmedAt ? text(value.confirmedAt, 100) : null,
    confirmedBy: value.confirmedBy ? structuredClone(value.confirmedBy) : null,
  };
}

export function playbookContentHash(playbook) {
  const content = {
    title: playbook.title,
    summary: playbook.summary,
    audience: playbook.audience,
    deliveryTarget: playbook.deliveryTarget,
    planningDepth: playbook.planningDepth,
    goldenStack: playbook.goldenStack,
    source: playbook.source,
    skillBindingAssessment: playbook.skillBindingAssessment,
    stages: playbook.stages,
  };
  return crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

// Compatibility helper for workspaces written before verification evidence was
// separated from the immutable Playbook content hash. Keep the original key
// order: persisted progress and confirmation records may still reference it.
export function legacyPlaybookContentHashV1(playbook) {
  const content = {
    title: playbook.title,
    summary: playbook.summary,
    audience: playbook.audience,
    deliveryTarget: playbook.deliveryTarget,
    goldenStack: playbook.goldenStack,
    source: playbook.source,
    skillBindingAssessment: playbook.skillBindingAssessment,
    stages: playbook.stages,
    verificationLevel: playbook.verificationLevel,
  };
  return crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export function assertPlaybookConfirmable(playbook) {
  if (!playbook?.stages?.length) throw new Error("playbook-not-confirmable:stages");
  if (playbook.verificationLevel !== "maintainer-reviewed") {
    throw new Error("playbook-not-confirmable:maintainer-review-required");
  }
}

export function publicPlaybook(playbook) {
  const result = structuredClone(playbook);
  if (!result.planningDepth) {
    result.planningDepth = result.stages?.length <= 3 ? "quick" : result.stages?.length <= 5 ? "standard" : "full";
  }
  result.contentHash = playbookContentHash(playbook);
  return result;
}
