import crypto from "node:crypto";

export const PLAYBOOK_PROGRESS_SCHEMA_VERSION = "1";

function text(value, maximum = 4_000) {
  return String(value || "").trim().slice(0, maximum);
}

function normalizeEvidence(value) {
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

function normalizeStepRecords(value) {
  if (!Array.isArray(value)) return [];
  const statuses = new Set(["not-started", "in-progress", "completed"]);
  const acceptance = new Set(["pending", "passed", "failed"]);
  return value.slice(0, 1_000).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const stageId = text(item.stageId, 200);
    const stepId = text(item.stepId, 200);
    if (!stageId || !stepId) return [];
    return [{
      stageId,
      stepId,
      status: statuses.has(item.status) ? item.status : "not-started",
      acceptanceResult: acceptance.has(item.acceptanceResult) ? item.acceptanceResult : "pending",
      notes: text(item.notes, 4_000),
      evidence: normalizeEvidence(item.evidence),
      updatedAt: text(item.updatedAt, 100),
      updatedBy: structuredClone(item.updatedBy || null),
    }];
  });
}

function normalizeGateRecords(value) {
  if (!Array.isArray(value)) return [];
  const statuses = new Set(["pending", "passed", "failed", "not-applicable"]);
  return value.slice(0, 100).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const stageId = text(item.stageId, 200);
    if (!stageId) return [];
    return [{
      stageId,
      status: statuses.has(item.status) ? item.status : "pending",
      rationale: text(item.rationale, 4_000),
      evidence: normalizeEvidence(item.evidence),
      updatedAt: text(item.updatedAt, 100),
      updatedBy: structuredClone(item.updatedBy || null),
    }];
  });
}

export function normalizePlaybookProgressInput(value, {
  id = crypto.randomUUID(),
  workflowId,
  playbookId,
  playbookContentHash,
  revision = 1,
  timestamps = {},
} = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("playbook-progress-object-required");
  const resolvedWorkflowId = text(workflowId || value.workflowId, 200);
  const resolvedPlaybookId = text(playbookId || value.playbookId, 200);
  const resolvedHash = text(playbookContentHash || value.playbookContentHash, 200);
  if (!resolvedWorkflowId || !resolvedPlaybookId || !resolvedHash) throw new Error("playbook-progress-source-required");
  const createdAt = timestamps.createdAt || new Date().toISOString();
  const updatedAt = timestamps.updatedAt || createdAt;
  return {
    schemaVersion: PLAYBOOK_PROGRESS_SCHEMA_VERSION,
    id: text(id || value.id, 200),
    workflowId: resolvedWorkflowId,
    playbookId: resolvedPlaybookId,
    playbookContentHash: resolvedHash,
    playbookRevision: Math.max(1, Number(value.playbookRevision) || 1),
    revision: Math.max(1, Number(revision) || 1),
    steps: normalizeStepRecords(value.steps),
    gates: normalizeGateRecords(value.gates),
    createdAt,
    updatedAt,
    createdBy: structuredClone(value.createdBy || null),
    updatedBy: structuredClone(value.updatedBy || null),
  };
}

export function normalizeProgressEvidence(value) {
  return normalizeEvidence(value);
}

export function publicPlaybookProgress(progress) {
  return structuredClone(progress);
}
