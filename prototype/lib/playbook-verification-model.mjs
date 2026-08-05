import crypto from "node:crypto";

export const PLAYBOOK_VERIFICATION_SCHEMA_VERSION = "1";
export const PLAYBOOK_VERIFICATION_LEVELS = [
  "agent-generated",
  "maintainer-reviewed",
  "sample-run",
  "novice-validated",
];

function text(value, maximum = 4_000) {
  return String(value || "").trim().slice(0, maximum);
}

function textList(value, { maximum = 50, itemMaximum = 1_000 } = {}) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, itemMaximum)).filter(Boolean))].slice(0, maximum);
}

function evidence(value) {
  if (!Array.isArray(value)) return [];
  const allowedKinds = new Set(["note", "link", "artifact", "test-result"]);
  return value.slice(0, 50).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const evidenceValue = text(item.value, 2_000);
    if (!evidenceValue) return [];
    return [{
      kind: allowedKinds.has(item.kind) ? item.kind : "note",
      label: text(item.label, 300),
      value: evidenceValue,
    }];
  });
}

export function verificationRank(level) {
  return PLAYBOOK_VERIFICATION_LEVELS.indexOf(level);
}

export function nextVerificationLevel(level) {
  const index = verificationRank(level);
  return index >= 0 && index < PLAYBOOK_VERIFICATION_LEVELS.length - 1
    ? PLAYBOOK_VERIFICATION_LEVELS[index + 1]
    : null;
}

export function sampleRunReadiness(playbook, progress) {
  const applicableStages = (playbook?.stages || []).filter((stage) => stage.applicability !== "not-applicable");
  const requiredSteps = applicableStages.flatMap((stage) => stage.steps.map((step) => ({ stageId: stage.id, stepId: step.id })));
  const missingStepIds = requiredSteps.filter(({ stageId, stepId }) => {
    const record = progress?.steps?.find((item) => item.stageId === stageId && item.stepId === stepId);
    return !record || record.status !== "completed" || record.acceptanceResult !== "passed";
  }).map(({ stepId }) => stepId);
  const missingGateIds = (playbook?.stages || []).filter((stage) => {
    const record = progress?.gates?.find((item) => item.stageId === stage.id);
    if (stage.applicability === "not-applicable") return !record || record.status !== "not-applicable";
    return !record || record.status !== "passed";
  }).map((stage) => stage.id);
  return {
    eligible: Boolean(progress) && !missingStepIds.length && !missingGateIds.length,
    progressStarted: Boolean(progress),
    totalSteps: requiredSteps.length,
    completedSteps: requiredSteps.length - missingStepIds.length,
    totalGates: (playbook?.stages || []).length,
    passedGates: (playbook?.stages || []).length - missingGateIds.length,
    missingStepIds: missingStepIds.slice(0, 100),
    missingGateIds: missingGateIds.slice(0, 100),
  };
}

export function normalizePlaybookVerificationInput(value, {
  id = crypto.randomUUID(),
  workflowId,
  playbookId,
  playbookContentHash,
  playbookVersion,
  playbookRevision,
  progressId = null,
  progressRevision = null,
  previousVerificationId = null,
  verifiedAt = new Date().toISOString(),
  verifiedBy = null,
} = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("playbook-verification-object-required");
  const level = value.level;
  if (!new Set(["sample-run", "novice-validated"]).has(level)) throw new Error("playbook-verification-level-invalid");
  const summary = text(value.summary, 4_000);
  const cleanEvidence = evidence(value.evidence);
  const blockers = textList(value.blockers, { maximum: 50, itemMaximum: 1_000 });
  if (!summary) throw new Error("playbook-verification-summary-required");
  if (!cleanEvidence.length) throw new Error("playbook-verification-evidence-required");
  if (blockers.length) throw new Error("playbook-verification-blockers-present");
  const sampleName = text(value.sampleName, 300);
  const environment = text(value.environment, 2_000);
  const testerProfile = text(value.testerProfile, 2_000);
  const assistanceLevel = text(value.assistanceLevel, 100);
  if (level === "sample-run" && !sampleName) throw new Error("playbook-verification-sample-required");
  if (level === "sample-run" && !environment) throw new Error("playbook-verification-environment-required");
  if (level === "novice-validated" && !testerProfile) throw new Error("playbook-verification-tester-required");
  if (level === "novice-validated" && !new Set(["none", "limited"]).has(assistanceLevel)) {
    throw new Error("playbook-verification-assistance-invalid");
  }
  return {
    schemaVersion: PLAYBOOK_VERIFICATION_SCHEMA_VERSION,
    id: text(id, 200),
    workflowId: text(workflowId || value.workflowId, 200),
    playbookId: text(playbookId || value.playbookId, 200),
    playbookContentHash: text(playbookContentHash || value.playbookContentHash, 200),
    playbookVersion: Math.max(1, Number(playbookVersion || value.playbookVersion) || 1),
    playbookRevision: Math.max(1, Number(playbookRevision || value.playbookRevision) || 1),
    progressId: progressId ? text(progressId, 200) : null,
    progressRevision: progressRevision ? Math.max(1, Number(progressRevision) || 1) : null,
    previousVerificationId: previousVerificationId ? text(previousVerificationId, 200) : null,
    level,
    summary,
    sampleName,
    environment,
    testerProfile,
    assistanceLevel: level === "novice-validated" ? assistanceLevel : "",
    blockers,
    evidence: cleanEvidence,
    verifiedAt: text(verifiedAt, 100),
    verifiedBy: structuredClone(verifiedBy),
  };
}

export function publicPlaybookVerification(record) {
  return structuredClone(record);
}
