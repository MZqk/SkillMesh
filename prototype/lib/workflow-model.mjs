import crypto from "node:crypto";

export const WORKFLOW_SCHEMA_VERSION = "1";

const LIMITS = {
  stages: 50,
  capabilitiesPerStage: 50,
  listItems: 100,
  installationPlans: 50,
  installationItems: 250,
  text: 4_000,
  goal: 2_000,
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

function stringList(value, { maximum = LIMITS.listItems, itemMaximum = 500 } = {}) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, itemMaximum)).filter(Boolean))].slice(0, maximum);
}

function normalizeRequirement(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const riskLevels = new Set(["low", "medium", "high", "critical"]);
  return {
    taskType: text(source.taskType, 200),
    targetPlatforms: stringList(source.targetPlatforms, { maximum: 20, itemMaximum: 100 }),
    targetAgents: stringList(source.targetAgents, { maximum: 20, itemMaximum: 100 }),
    targetUsers: stringList(source.targetUsers, { maximum: 50, itemMaximum: 300 }),
    preferredStack: stringList(source.preferredStack, { maximum: 50, itemMaximum: 100 }),
    constraints: stringList(source.constraints),
    inputs: stringList(source.inputs),
    desiredOutputs: stringList(source.desiredOutputs),
    riskLevel: riskLevels.has(source.riskLevel) ? source.riskLevel : "medium",
  };
}

function normalizeReference(value, goal) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const allowedTypes = new Set(["human-curated", "human-confirmed", "agent-draft", "custom"]);
  return {
    id: text(source.id, 200) || "custom-workflow",
    name: text(source.name, 300) || goal,
    version: text(source.version, 100) || "1",
    referenceType: allowedTypes.has(source.referenceType) ? source.referenceType : "agent-draft",
    description: text(source.description),
  };
}

function normalizeCapabilities(value, stageId) {
  if (!Array.isArray(value) || !value.length) throw new Error(`stage-capabilities-required:${stageId}`);
  const used = new Set();
  return value.slice(0, LIMITS.capabilitiesPerStage).map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`invalid-capability:${stageId}:${index + 1}`);
    }
    const id = identifier(item.id || item.label, `capability-${index + 1}`);
    if (used.has(id)) throw new Error(`duplicate-capability-id:${id}`);
    used.add(id);
    const label = text(item.label, 300);
    if (!label) throw new Error(`capability-label-required:${id}`);
    return {
      id,
      label,
      description: text(item.description),
      required: item.required !== false,
      terms: stringList(item.terms, { maximum: 100, itemMaximum: 200 }),
      acceptanceCriteria: stringList(item.acceptanceCriteria),
    };
  });
}

export function normalizeStages(value) {
  if (!Array.isArray(value) || !value.length) throw new Error("workflow-stages-required");
  const stageIds = new Set();
  const stages = value.slice(0, LIMITS.stages).map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`invalid-stage:${index + 1}`);
    }
    const id = identifier(item.id || item.title, `stage-${index + 1}`);
    if (stageIds.has(id)) throw new Error(`duplicate-stage-id:${id}`);
    stageIds.add(id);
    const title = text(item.title, 300);
    if (!title) throw new Error(`stage-title-required:${id}`);
    return {
      id,
      order: index + 1,
      phase: text(item.phase, 120) || `阶段 ${index + 1}`,
      title,
      summary: text(item.summary),
      description: text(item.description),
      dependencies: stringList(item.dependencies, { maximum: LIMITS.stages, itemMaximum: 100 }).map((entry) => identifier(entry)),
      deliverables: stringList(item.deliverables),
      acceptanceGate: text(item.acceptanceGate),
      questions: stringList(item.questions),
      capabilities: normalizeCapabilities(item.capabilities, id),
    };
  });

  const prior = new Set();
  for (const stage of stages) {
    for (const dependency of stage.dependencies) {
      if (!stageIds.has(dependency)) throw new Error(`unknown-stage-dependency:${stage.id}:${dependency}`);
      if (!prior.has(dependency)) throw new Error(`stage-dependency-must-precede:${stage.id}:${dependency}`);
    }
    prior.add(stage.id);
  }
  return stages;
}

export function normalizeActor(value, fallback = { type: "agent", name: "unknown-agent" }) {
  const allowedTypes = new Set(["agent", "human", "system", "migration"]);
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  const type = allowedTypes.has(source.type) ? source.type : fallback.type;
  return {
    type,
    name: text(source.name, 200) || fallback.name,
    version: text(source.version, 100),
    channel: text(source.channel, 100),
  };
}

export function normalizeWorkflowInput(value, { id = crypto.randomUUID(), revision = 1, timestamps = {} } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("workflow-object-required");
  const goal = text(value.goal, LIMITS.goal);
  if (!goal) throw new Error("workflow-goal-required");
  const scope = value.scope === "project" ? "project" : "global";
  const projectId = scope === "project" ? text(value.projectId, 200) : "";
  if (scope === "project" && !projectId) throw new Error("project-id-required");
  const createdAt = timestamps.createdAt || new Date().toISOString();
  const updatedAt = timestamps.updatedAt || createdAt;
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    id: text(id, 200),
    scope,
    projectId: projectId || null,
    goal,
    reference: normalizeReference(value.reference, goal),
    scopeDescription: text(value.scopeDescription),
    requirement: normalizeRequirement(value.requirement),
    nonGoals: stringList(value.nonGoals),
    acceptanceCriteria: stringList(value.acceptanceCriteria),
    stages: normalizeStages(value.stages),
    status: value.status === "confirmed" ? "confirmed" : "draft",
    revision: Math.max(1, Number(revision) || 1),
    reviews: normalizeReviews(value.reviews),
    validations: normalizeValidations(value.validations),
    suggestions: normalizeSuggestions(value.suggestions),
    externalCandidates: normalizeExternalCandidates(value.externalCandidates),
    installationPlans: normalizeInstallationPlans(value.installationPlans),
    confirmedVersion: Math.max(0, Number(value.confirmedVersion) || 0),
    baseConfirmationVersion: Math.max(0, Number(value.baseConfirmationVersion) || 0),
    createdAt,
    updatedAt,
    createdBy: normalizeActor(value.createdBy, { type: "system", name: "capability-atlas" }),
    updatedBy: normalizeActor(value.updatedBy, { type: "system", name: "capability-atlas" }),
    confirmedAt: value.confirmedAt ? text(value.confirmedAt, 100) : null,
    confirmedBy: value.confirmedBy ? normalizeActor(value.confirmedBy) : null,
  };
}

function normalizeReviews(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [stageId, decisions] of Object.entries(value).slice(0, LIMITS.stages)) {
    if (!decisions || typeof decisions !== "object" || Array.isArray(decisions)) continue;
    const clean = {};
    for (const [contentHash, review] of Object.entries(decisions).slice(0, 2_000)) {
      const record = typeof review === "string" ? { decision: review } : review;
      if (!record || !["confirmed", "partial", "excluded"].includes(record.decision)) continue;
      clean[text(contentHash, 200)] = {
        decision: record.decision,
        rationale: text(record.rationale, 1_000),
        actor: normalizeActor(record.actor, { type: "human", name: "local-user" }),
        updatedAt: text(record.updatedAt, 100) || new Date().toISOString(),
      };
    }
    if (Object.keys(clean).length) result[identifier(stageId)] = clean;
  }
  return result;
}

function normalizeValidations(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 2_000).flatMap(([contentHash, record]) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return [];
    return [[text(contentHash, 200), {
      status: record.status === "human-verified" ? "human-verified" : "unverified",
      agent: text(record.agent, 200),
      environment: text(record.environment, 500),
      skillVersion: text(record.skillVersion, 100),
      notes: text(record.notes, 1_000),
      actor: normalizeActor(record.actor, { type: "human", name: "local-user" }),
      updatedAt: text(record.updatedAt, 100) || new Date().toISOString(),
    }]];
  }));
}

function normalizeSuggestions(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-2_000).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const allowed = new Set(["match", "partial", "exclude", "optimize", "create", "find-external"]);
    if (!allowed.has(item.recommendation)) return [];
    return [{
      id: text(item.id, 200) || crypto.randomUUID(),
      stageId: item.stageId ? identifier(item.stageId) : null,
      capabilityId: item.capabilityId ? identifier(item.capabilityId) : null,
      skillContentHash: item.skillContentHash ? text(item.skillContentHash, 200) : null,
      recommendation: item.recommendation,
      rationale: text(item.rationale, 2_000),
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
      actor: normalizeActor(item.actor),
      createdAt: text(item.createdAt, 100) || new Date().toISOString(),
    }];
  });
}

function normalizeExternalCandidates(value) {
  if (!Array.isArray(value)) return [];
  const allowedStatuses = new Set(["suggested", "accepted", "rejected", "installed"]);
  return value.slice(-2_000).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const packageId = text(item.packageId || item.package, 500);
    const sourceUrl = text(item.sourceUrl, 1_000);
    if (!packageId && !sourceUrl) return [];
    return [{
      id: text(item.id, 200) || crypto.randomUUID(),
      stageId: item.stageId ? identifier(item.stageId) : null,
      capabilityId: item.capabilityId ? identifier(item.capabilityId) : null,
      query: text(item.query, 500),
      packageId,
      skillName: text(item.skillName, 300),
      sourceUrl,
      installCount: Math.max(0, Number(item.installCount) || 0),
      githubStars: Math.max(0, Number(item.githubStars) || 0),
      license: text(item.license, 100),
      publisher: text(item.publisher, 300),
      securityNotes: text(item.securityNotes, 1_000),
      rationale: text(item.rationale, 2_000),
      status: allowedStatuses.has(item.status) ? item.status : "suggested",
      actor: normalizeActor(item.actor),
      createdAt: text(item.createdAt, 100) || new Date().toISOString(),
      updatedAt: text(item.updatedAt, 100) || text(item.createdAt, 100) || new Date().toISOString(),
    }];
  });
}

function normalizeCapabilityRefs(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, LIMITS.listItems).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const stageId = text(item.stageId, 200);
    const capabilityId = text(item.capabilityId, 200);
    if (!stageId || !capabilityId) return [];
    return [{
      key: text(item.key, 500) || `${stageId}:${capabilityId}`,
      stageId,
      capabilityId,
      label: text(item.label, 300),
      required: item.required !== false,
      strength: ["strong", "weak", "external", "none"].includes(item.strength) ? item.strength : "none",
    }];
  });
}

function normalizeSecurityScan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const allowedStatuses = new Set(["pending", "passed", "warning", "blocked", "failed"]);
  const allowedSeverities = new Set(["none", "low", "medium", "high", "critical"]);
  return {
    status: allowedStatuses.has(value.status) ? value.status : "pending",
    severity: allowedSeverities.has(value.severity) ? value.severity : "none",
    findings: Array.isArray(value.findings) ? value.findings.slice(0, 200).flatMap((finding) => {
      if (!finding || typeof finding !== "object" || Array.isArray(finding)) return [];
      return [{
        id: text(finding.id, 200),
        severity: allowedSeverities.has(finding.severity) ? finding.severity : "low",
        message: text(finding.message, 1_000),
        file: text(finding.file, 1_000),
      }];
    }) : [],
    filesScanned: Math.max(0, Number(value.filesScanned) || 0),
    bytesScanned: Math.max(0, Number(value.bytesScanned) || 0),
    truncated: value.truncated === true,
    scannedAt: value.scannedAt ? text(value.scannedAt, 100) : null,
  };
}

function normalizeInstallationItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const allowedTypes = new Set(["local-sync", "external-install"]);
  const allowedStatuses = new Set([
    "planned",
    "queued",
    "running",
    "installed",
    "installed-warning",
    "already-installed",
    "skipped",
    "failed",
    "quarantined",
    "cancelled",
    "needs-repair",
  ]);
  const type = allowedTypes.has(value.type) ? value.type : null;
  const id = text(value.id, 200);
  if (!type || !id) return null;
  const targetPaths = value.targetPaths && typeof value.targetPaths === "object" && !Array.isArray(value.targetPaths)
    ? Object.fromEntries(Object.entries(value.targetPaths).slice(0, 20).map(([agent, targetPath]) => [
      text(agent, 100),
      text(targetPath, 1_000),
    ]).filter(([agent, targetPath]) => agent && targetPath))
    : {};
  const conflict = value.conflict && typeof value.conflict === "object" && !Array.isArray(value.conflict)
    ? value.conflict
    : {};
  return {
    id,
    externalCandidateId: value.externalCandidateId ? text(value.externalCandidateId, 200) : null,
    externalCandidateStatus: ["accepted", "installed"].includes(value.externalCandidateStatus)
      ? value.externalCandidateStatus
      : null,
    type,
    name: text(value.name, 300),
    installName: text(value.installName, 200),
    sourcePath: text(value.sourcePath, 1_000),
    contentHash: text(value.contentHash, 200),
    installedContentHash: text(value.installedContentHash, 200),
    packageId: text(value.packageId, 500),
    sourceUrl: text(value.sourceUrl, 1_000),
    version: text(value.version, 100),
    sourceKind: text(value.sourceKind, 100),
    supportedAgents: stringList(value.supportedAgents, { maximum: 20, itemMaximum: 100 }),
    targetAgents: stringList(value.targetAgents, { maximum: 20, itemMaximum: 100 }),
    canonicalPath: text(value.canonicalPath, 1_000),
    targetPaths,
    command: stringList(value.command, { maximum: 100, itemMaximum: 1_000 }),
    installMode: ["managed-symlink", "skills-cli"].includes(value.installMode) ? value.installMode : "managed-symlink",
    capabilityRefs: normalizeCapabilityRefs(value.capabilityRefs),
    score: Math.max(0, Math.min(1, Number(value.score) || 0)),
    eligible: value.eligible !== false,
    selected: value.selected === true,
    status: allowedStatuses.has(value.status) ? value.status : "planned",
    riskFlags: stringList(value.riskFlags, { maximum: 50, itemMaximum: 200 }),
    incompatibleAgents: stringList(value.incompatibleAgents, { maximum: 20, itemMaximum: 100 }),
    conflict: {
      status: ["unchecked", "none", "same-content", "different-content", "target-conflict"].includes(conflict.status)
        ? conflict.status
        : "unchecked",
      resolution: ["keep", "replace", "rename"].includes(conflict.resolution) ? conflict.resolution : "keep",
      renameTo: text(conflict.renameTo, 200),
      details: text(conflict.details, 1_000),
    },
    acknowledgements: stringList(value.acknowledgements, { maximum: 50, itemMaximum: 200 }),
    reinstallLatest: value.reinstallLatest === true,
    securityScan: normalizeSecurityScan(value.securityScan),
    discovered: value.discovered && typeof value.discovered === "object" && !Array.isArray(value.discovered)
      ? {
        found: value.discovered.found === true,
        providers: stringList(value.discovered.providers, { maximum: 20, itemMaximum: 100 }),
        agents: stringList(value.discovered.agents, { maximum: 20, itemMaximum: 100 }),
        checkedAt: text(value.discovered.checkedAt, 100),
      }
      : null,
    quarantinePath: text(value.quarantinePath, 1_000),
    error: text(value.error, 2_000),
    startedAt: value.startedAt ? text(value.startedAt, 100) : null,
    completedAt: value.completedAt ? text(value.completedAt, 100) : null,
  };
}

export function normalizeInstallationPlans(value) {
  if (!Array.isArray(value)) return [];
  const allowedStatuses = new Set([
    "draft",
    "queued",
    "running",
    "completed",
    "partial",
    "cancelled",
    "failed",
    "interrupted",
    "needs-repair",
  ]);
  return value.slice(-LIMITS.installationPlans).flatMap((plan) => {
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) return [];
    const id = text(plan.id, 200);
    if (!id) return [];
    const execution = plan.execution && typeof plan.execution === "object" && !Array.isArray(plan.execution)
      ? plan.execution
      : {};
    const coverage = plan.coverage && typeof plan.coverage === "object" && !Array.isArray(plan.coverage)
      ? plan.coverage
      : {};
    return [{
      id,
      kind: "skill-installation",
      status: allowedStatuses.has(plan.status) ? plan.status : "draft",
      workflowId: text(plan.workflowId, 200),
      basedOnRevision: Math.max(1, Number(plan.basedOnRevision) || 1),
      targetAgents: stringList(plan.targetAgents, { maximum: 20, itemMaximum: 100 }),
      sharedRoot: text(plan.sharedRoot, 1_000),
      items: Array.isArray(plan.items)
        ? plan.items.slice(0, LIMITS.installationItems).map(normalizeInstallationItem).filter(Boolean)
        : [],
      coverage: {
        required: Math.max(0, Number(coverage.required) || 0),
        covered: Math.max(0, Number(coverage.covered) || 0),
        uncovered: Array.isArray(coverage.uncovered) ? coverage.uncovered.slice(0, LIMITS.listItems).flatMap((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return [];
          return [{
            key: text(item.key, 500),
            stageId: text(item.stageId, 200),
            capabilityId: text(item.capabilityId, 200),
            label: text(item.label, 300),
          }];
        }) : [],
      },
      execution: {
        jobId: execution.jobId ? text(execution.jobId, 200) : null,
        startedAt: execution.startedAt ? text(execution.startedAt, 100) : null,
        completedAt: execution.completedAt ? text(execution.completedAt, 100) : null,
        cancelRequestedAt: execution.cancelRequestedAt ? text(execution.cancelRequestedAt, 100) : null,
        reloadPending: stringList(execution.reloadPending, { maximum: 20, itemMaximum: 100 }),
        journalPath: text(execution.journalPath, 1_000),
        residualPaths: stringList(execution.residualPaths, { maximum: 100, itemMaximum: 1_000 }),
        message: text(execution.message, 2_000),
      },
      reassessment: Array.isArray(plan.reassessment) ? plan.reassessment.slice(0, 20).flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        return [{
          targetAgent: text(item.targetAgent, 100),
          matchScore: Math.max(0, Math.min(1, Number(item.matchScore) || 0)),
          coverageRatio: Math.max(0, Math.min(1, Number(item.coverageRatio) || 0)),
          missingRequiredCapabilities: Math.max(0, Number(item.missingRequiredCapabilities) || 0),
          assessedAt: text(item.assessedAt, 100),
        }];
      }) : [],
      createdAt: text(plan.createdAt, 100) || new Date().toISOString(),
      updatedAt: text(plan.updatedAt, 100) || new Date().toISOString(),
      createdBy: normalizeActor(plan.createdBy),
      updatedBy: normalizeActor(plan.updatedBy),
    }];
  });
}

export function assertConfirmable(workflow) {
  const missing = [];
  if (!text(workflow.goal, LIMITS.goal)) missing.push("goal");
  if (!text(workflow.scopeDescription)) missing.push("scopeDescription");
  if (!Array.isArray(workflow.nonGoals) || !workflow.nonGoals.length) missing.push("nonGoals");
  if (!Array.isArray(workflow.acceptanceCriteria) || !workflow.acceptanceCriteria.length) missing.push("acceptanceCriteria");
  if (!Array.isArray(workflow.stages) || !workflow.stages.length) missing.push("stages");
  if (missing.length) throw new Error(`workflow-not-confirmable:${missing.join(",")}`);
}

export function decisionsForMatcher(workflow) {
  return Object.fromEntries(Object.entries(workflow.reviews || {}).map(([stageId, reviews]) => [
    stageId,
    Object.fromEntries(Object.entries(reviews).map(([contentHash, review]) => [contentHash, review.decision])),
  ]));
}

export function workflowForMatcher(workflow) {
  return {
    id: workflow.reference?.id || workflow.id,
    name: workflow.reference?.name || workflow.goal,
    version: workflow.reference?.version || String(workflow.confirmedVersion || workflow.revision),
    referenceType: workflow.status === "confirmed" ? "human-confirmed" : workflow.reference?.referenceType || "agent-draft",
    description: workflow.reference?.description || workflow.scopeDescription || "尚未补充范围说明的工作流草案。",
    goal: workflow.goal,
    scopeDescription: workflow.scopeDescription,
    requirement: workflow.requirement,
    nonGoals: workflow.nonGoals,
    acceptanceCriteria: workflow.acceptanceCriteria,
    stages: workflow.stages,
  };
}

function redactInstallationDetails(workflow) {
  for (const plan of workflow.installationPlans || []) {
    delete plan.sharedRoot;
    delete plan.execution?.journalPath;
    if (plan.execution) delete plan.execution.residualPaths;
    for (const item of plan.items || []) {
      delete item.sourcePath;
      delete item.canonicalPath;
      delete item.targetPaths;
      delete item.command;
      delete item.quarantinePath;
    }
  }
}

export function publicWorkflow(workflow, {
  includeStages = true,
  includeSuggestions = true,
  redactSensitive = false,
} = {}) {
  const result = structuredClone(workflow);
  if (!includeStages) delete result.stages;
  if (!includeSuggestions) delete result.suggestions;
  if (redactSensitive) redactInstallationDetails(result);
  return result;
}
