import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  assertPlaybookConfirmable,
  legacyPlaybookContentHashV1,
  normalizePlaybookInput,
  publicPlaybook,
} from "./playbook-model.mjs";
import { diffPlaybooks } from "./playbook-diff.mjs";
import {
  normalizePlaybookProgressInput,
  normalizeProgressEvidence,
  publicPlaybookProgress,
} from "./playbook-progress-model.mjs";
import {
  nextVerificationLevel,
  normalizePlaybookVerificationInput,
  publicPlaybookVerification,
  sampleRunReadiness,
} from "./playbook-verification-model.mjs";
import {
  assertProjectBriefFreezable,
  normalizeProjectBriefInput,
  publicProjectBrief,
} from "./project-brief-model.mjs";
import {
  assertConfirmable,
  normalizeActor,
  normalizeStages,
  normalizeWorkflowInput,
  publicWorkflow,
} from "./workflow-model.mjs";

const MAX_STORE_BYTES = 20 * 1024 * 1024;
const MAX_EVENTS = 5_000;
const MAX_CONFIRMATIONS = 1_000;
const MAX_PROJECT_BRIEFS = 500;
const MAX_PLAYBOOKS = 500;
const MAX_PLAYBOOK_PROGRESS_RECORDS = 2_000;
const MAX_PLAYBOOK_VERIFICATION_RECORDS = 2_000;
const PLAYBOOK_CONTENT_HASH_VERSION = 2;

export class WorkflowConflictError extends Error {
  constructor(currentRevision) {
    super("workflow-revision-conflict");
    this.name = "WorkflowConflictError";
    this.currentRevision = currentRevision;
  }
}

export class WorkflowNotFoundError extends Error {
  constructor() {
    super("workflow-not-found");
    this.name = "WorkflowNotFoundError";
  }
}

export function defaultDataDirectory() {
  if (process.env.CAPABILITY_ATLAS_DATA_DIR) return path.resolve(process.env.CAPABILITY_ATLAS_DATA_DIR);
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Capability Atlas");
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Capability Atlas");
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "capability-atlas");
}

export function defaultStorePath() {
  return path.join(defaultDataDirectory(), "workspace.json");
}

function emptyStore() {
  return {
    schemaVersion: "1",
    playbookContentHashVersion: PLAYBOOK_CONTENT_HASH_VERSION,
    revision: 0,
    updatedAt: null,
    settings: { customRoots: [], revision: 0 },
    workflows: [],
    confirmations: [],
    projectBriefs: [],
    projectBriefConfirmations: [],
    playbooks: [],
    playbookConfirmations: [],
    playbookProgress: [],
    playbookVerifications: [],
    events: [],
  };
}

function migrateLegacyPlaybookHashes(data) {
  const replacements = new Map();
  const candidates = [
    ...(Array.isArray(data.playbooks) ? data.playbooks : []),
    ...(Array.isArray(data.playbookConfirmations) ? data.playbookConfirmations : [])
      .map((item) => item?.snapshot)
      .filter(Boolean),
  ];
  for (const playbook of candidates) {
    const legacyHash = legacyPlaybookContentHashV1(playbook);
    const currentHash = publicPlaybook(playbook).contentHash;
    if (legacyHash !== currentHash) {
      const targets = replacements.get(legacyHash) || new Set();
      targets.add(currentHash);
      replacements.set(legacyHash, targets);
    }
  }
  const replace = (value) => {
    const targets = replacements.get(value);
    return targets?.size === 1 ? [...targets][0] : value;
  };
  for (const confirmation of Array.isArray(data.playbookConfirmations) ? data.playbookConfirmations : []) {
    confirmation.contentHash = replace(confirmation.contentHash);
  }
  for (const progress of Array.isArray(data.playbookProgress) ? data.playbookProgress : []) {
    progress.playbookContentHash = replace(progress.playbookContentHash);
  }
  for (const verification of Array.isArray(data.playbookVerifications) ? data.playbookVerifications : []) {
    verification.playbookContentHash = replace(verification.playbookContentHash);
  }
  data.playbookContentHashVersion = PLAYBOOK_CONTENT_HASH_VERSION;
  return data;
}

function boundedLimit(value, fallback = 50, maximum = 100) {
  return Math.max(1, Math.min(maximum, Number(value) || fallback));
}

function cursorOffset(cursor) {
  if (!cursor) return 0;
  const value = Number(Buffer.from(String(cursor), "base64url").toString("utf8"));
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function nextCursor(offset, limit, total) {
  const next = offset + limit;
  return next < total ? Buffer.from(String(next)).toString("base64url") : null;
}

function event(type, workflow, actor, details = {}) {
  return {
    id: crypto.randomUUID(),
    type,
    workflowId: workflow?.id || null,
    workflowRevision: workflow?.revision || null,
    actor: normalizeActor(actor),
    details,
    createdAt: new Date().toISOString(),
  };
}

function ensureExpectedRevision(workflow, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new Error("expected-revision-required");
  if (workflow.revision !== expectedRevision) throw new WorkflowConflictError(workflow.revision);
}

function progressSummary(playbook, progress) {
  const requiredStages = (playbook.stages || []).filter((stage) => stage.applicability !== "not-applicable");
  const totalSteps = requiredStages.reduce((total, stage) => total + stage.steps.length, 0);
  const completedSteps = (progress?.steps || []).filter((step) => step.status === "completed").length;
  const passedGates = (progress?.gates || []).filter((gate) => gate.status === "passed" || gate.status === "not-applicable").length;
  return {
    totalSteps,
    completedSteps,
    completionRatio: Number((completedSteps / Math.max(1, totalSteps)).toFixed(2)),
    totalGates: playbook.stages.length,
    passedGates,
  };
}

function playbookVerificationView(data, playbook) {
  const playbookView = publicPlaybook(playbook);
  const records = data.playbookVerifications
    .filter((item) => item.playbookId === playbook.id && item.playbookContentHash === playbookView.contentHash)
    .sort((left, right) => left.verifiedAt.localeCompare(right.verifiedAt));
  const progress = data.playbookProgress.find((item) =>
    item.playbookId === playbook.id && item.playbookContentHash === playbookView.contentHash) || null;
  const readiness = sampleRunReadiness(playbook, progress);
  const nextLevel = playbook.status === "confirmed" ? nextVerificationLevel(playbook.verificationLevel) : "maintainer-reviewed";
  const eligible = nextLevel === "sample-run"
    ? readiness.eligible
    : nextLevel === "novice-validated"
      ? records.some((item) => item.level === "sample-run")
      : false;
  return {
    workflowId: playbook.workflowId,
    playbookId: playbook.id,
    playbookVersion: playbook.confirmedVersion,
    playbookRevision: playbook.revision,
    playbookContentHash: playbookView.contentHash,
    status: playbook.status,
    currentLevel: playbook.verificationLevel,
    nextLevel,
    eligible,
    sampleRunReadiness: readiness,
    records: records.map(publicPlaybookVerification),
    staleRecords: data.playbookVerifications
      .filter((item) => item.playbookId === playbook.id && item.playbookContentHash !== playbookView.contentHash)
      .map((item) => ({
        id: item.id,
        level: item.level,
        playbookContentHash: item.playbookContentHash,
        verifiedAt: item.verifiedAt,
      })),
  };
}

function playbookStageAndStep(playbook, stageId, stepId) {
  const stage = playbook.stages.find((item) => item.id === stageId);
  if (!stage) throw new Error("playbook-stage-not-found");
  const step = stage.steps.find((item) => item.id === stepId);
  if (!step) throw new Error("playbook-step-not-found");
  return { stage, step };
}

export class WorkflowStore {
  constructor({ filePath = defaultStorePath() } = {}) {
    this.filePath = path.resolve(filePath);
    this.lockPath = `${this.filePath}.lock`;
  }

  async #readUnlocked() {
    try {
      const stats = await fs.stat(this.filePath);
      if (stats.size > MAX_STORE_BYTES) throw new Error("workflow-store-too-large");
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      if (!parsed || parsed.schemaVersion !== "1" || !Array.isArray(parsed.workflows)) {
        throw new Error("workflow-store-invalid");
      }
      const data = {
        ...emptyStore(),
        ...parsed,
        settings: { ...emptyStore().settings, ...(parsed.settings || {}) },
        confirmations: Array.isArray(parsed.confirmations) ? parsed.confirmations : [],
        projectBriefs: Array.isArray(parsed.projectBriefs) ? parsed.projectBriefs : [],
        projectBriefConfirmations: Array.isArray(parsed.projectBriefConfirmations) ? parsed.projectBriefConfirmations : [],
        playbooks: Array.isArray(parsed.playbooks) ? parsed.playbooks : [],
        playbookConfirmations: Array.isArray(parsed.playbookConfirmations) ? parsed.playbookConfirmations : [],
        playbookProgress: Array.isArray(parsed.playbookProgress) ? parsed.playbookProgress : [],
        playbookVerifications: Array.isArray(parsed.playbookVerifications) ? parsed.playbookVerifications : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
      };
      return Number(parsed.playbookContentHashVersion) >= PLAYBOOK_CONTENT_HASH_VERSION
        ? data
        : migrateLegacyPlaybookHashes(data);
    } catch (error) {
      if (error.code === "ENOENT") return emptyStore();
      throw error;
    }
  }

  async read() {
    return structuredClone(await this.#readUnlocked());
  }

  async #acquireLock() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await fs.mkdir(this.lockPath, { mode: 0o700 });
        return;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        try {
          const stats = await fs.stat(this.lockPath);
          if (Date.now() - stats.mtimeMs > 30_000) await fs.rmdir(this.lockPath);
        } catch (lockError) {
          if (lockError.code !== "ENOENT" && lockError.code !== "ENOTEMPTY") throw lockError;
        }
        await new Promise((resolve) => setTimeout(resolve, 20 + attempt * 2));
      }
    }
    throw new Error("workflow-store-busy");
  }

  async #writeUnlocked(data) {
    data.revision = Math.max(0, Number(data.revision) || 0) + 1;
    data.updatedAt = new Date().toISOString();
    data.events = data.events.slice(-MAX_EVENTS);
    data.confirmations = data.confirmations.slice(-MAX_CONFIRMATIONS);
    data.projectBriefConfirmations = data.projectBriefConfirmations.slice(-MAX_CONFIRMATIONS);
    data.playbookConfirmations = data.playbookConfirmations.slice(-MAX_CONFIRMATIONS);
    data.playbookProgress = data.playbookProgress.slice(-MAX_PLAYBOOK_PROGRESS_RECORDS);
    data.playbookVerifications = data.playbookVerifications.slice(-MAX_PLAYBOOK_VERIFICATION_RECORDS);
    const temporaryPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporaryPath, this.filePath);
  }

  async #mutate(mutator) {
    await this.#acquireLock();
    try {
      const data = await this.#readUnlocked();
      const result = await mutator(data);
      await this.#writeUnlocked(data);
      return structuredClone(result);
    } finally {
      await fs.rmdir(this.lockPath).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }

  async summary() {
    const data = await this.#readUnlocked();
    return {
      schemaVersion: data.schemaVersion,
      revision: data.revision,
      updatedAt: data.updatedAt,
      workflows: data.workflows.length,
      drafts: data.workflows.filter((item) => item.status === "draft").length,
      confirmed: data.workflows.filter((item) => item.status === "confirmed").length,
      confirmationVersions: data.confirmations.length,
      projectBriefs: data.projectBriefs.length,
      frozenProjectBriefs: data.projectBriefs.filter((item) => item.status === "frozen").length,
      playbooks: data.playbooks.length,
      confirmedPlaybooks: data.playbooks.filter((item) => item.status === "confirmed").length,
      playbookProgressSessions: data.playbookProgress.length,
      playbookVerificationRecords: data.playbookVerifications.length,
      dataLocation: "local-user-data",
    };
  }

  async getSettings() {
    const data = await this.#readUnlocked();
    return structuredClone(data.settings);
  }

  async updateSettings({ customRoots }, actor = { type: "human", name: "local-user", channel: "web" }) {
    if (!Array.isArray(customRoots)) throw new Error("custom-roots-must-be-an-array");
    const roots = [...new Set(customRoots.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 20);
    return this.#mutate((data) => {
      data.settings = { customRoots: roots, revision: (data.settings.revision || 0) + 1 };
      data.events.push(event("settings.updated", null, actor, { customRoots: roots.length }));
      return data.settings;
    });
  }

  async listWorkflows({ cursor, limit, scope, projectId, status } = {}) {
    const data = await this.#readUnlocked();
    const pageLimit = boundedLimit(limit);
    const offset = cursorOffset(cursor);
    const filtered = data.workflows
      .filter((workflow) => !scope || workflow.scope === scope)
      .filter((workflow) => !projectId || workflow.projectId === projectId)
      .filter((workflow) => !status || workflow.status === status)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return {
      items: filtered.slice(offset, offset + pageLimit).map((workflow) => ({
        ...publicWorkflow(workflow, { includeStages: false, redactSensitive: true }),
        confirmationCount: data.confirmations.filter((item) => item.workflowId === workflow.id).length,
      })),
      nextCursor: nextCursor(offset, pageLimit, filtered.length),
      total: filtered.length,
      storeRevision: data.revision,
    };
  }

  async getWorkflow(id, { includeHistory = false, redactSensitive = false } = {}) {
    const data = await this.#readUnlocked();
    const workflow = data.workflows.find((item) => item.id === id);
    if (!workflow) throw new WorkflowNotFoundError();
    const result = publicWorkflow(workflow, { redactSensitive });
    if (includeHistory) {
      result.history = data.confirmations
        .filter((item) => item.workflowId === id)
        .map(({ snapshot, ...metadata }) => metadata)
        .sort((left, right) => right.version - left.version);
    }
    return result;
  }

  async createWorkflow(input, actor = { type: "agent", name: "unknown-agent", channel: "mcp" }) {
    const normalizedActor = normalizeActor(actor);
    const workflow = normalizeWorkflowInput({
      ...input,
      status: "draft",
      createdBy: normalizedActor,
      updatedBy: normalizedActor,
    });
    return this.#mutate((data) => {
      if (data.workflows.length >= 500) throw new Error("too-many-workflows");
      data.workflows.push(workflow);
      data.events.push(event("workflow.created", workflow, normalizedActor));
      return publicWorkflow(workflow);
    });
  }

  async updateWorkflow(id, { expectedRevision, patch }, actor = { type: "agent", name: "unknown-agent", channel: "mcp" }) {
    const normalizedActor = normalizeActor(actor);
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("workflow-patch-required");
    return this.#mutate((data) => {
      const index = data.workflows.findIndex((item) => item.id === id);
      if (index < 0) throw new WorkflowNotFoundError();
      const current = data.workflows[index];
      ensureExpectedRevision(current, expectedRevision);
      const now = new Date().toISOString();
      const wasConfirmed = current.status === "confirmed";
      const candidate = normalizeWorkflowInput({
        ...current,
        ...patch,
        stages: patch.stages ? normalizeStages(patch.stages) : current.stages,
        status: wasConfirmed ? "draft" : current.status,
        baseConfirmationVersion: wasConfirmed ? current.confirmedVersion : current.baseConfirmationVersion,
        createdBy: current.createdBy,
        updatedBy: normalizedActor,
      }, {
        id: current.id,
        revision: current.revision + 1,
        timestamps: { createdAt: current.createdAt, updatedAt: now },
      });
      data.workflows[index] = candidate;
      data.events.push(event(wasConfirmed ? "workflow.revision-started" : "workflow.updated", candidate, normalizedActor));
      return publicWorkflow(candidate);
    });
  }

  async addSuggestion(id, { expectedRevision, suggestion }, actor = { type: "agent", name: "unknown-agent", channel: "mcp" }) {
    if (!suggestion || typeof suggestion !== "object" || Array.isArray(suggestion)) throw new Error("suggestion-required");
    const current = await this.getWorkflow(id);
    const suggestions = [...current.suggestions, {
      ...suggestion,
      id: crypto.randomUUID(),
      actor: normalizeActor(actor),
      createdAt: new Date().toISOString(),
    }];
    return this.updateWorkflow(id, { expectedRevision, patch: { suggestions } }, actor);
  }

  async addExternalCandidate(id, { expectedRevision, candidate }, actor = { type: "agent", name: "unknown-agent", channel: "mcp" }) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("external-candidate-required");
    if (!String(candidate.packageId || candidate.package || "").trim() && !String(candidate.sourceUrl || "").trim()) {
      throw new Error("external-candidate-source-required");
    }
    const current = await this.getWorkflow(id);
    if (candidate.stageId && !current.stages.some((stage) => stage.id === candidate.stageId)) {
      throw new Error("workflow-stage-not-found");
    }
    if (candidate.capabilityId && !current.stages.some((stage) =>
      stage.capabilities.some((capability) => capability.id === candidate.capabilityId))) {
      throw new Error("workflow-capability-not-found");
    }
    const now = new Date().toISOString();
    const externalCandidates = [...(current.externalCandidates || []), {
      ...candidate,
      id: crypto.randomUUID(),
      actor: normalizeActor(actor),
      status: candidate.status || "suggested",
      createdAt: now,
      updatedAt: now,
    }];
    return this.updateWorkflow(id, { expectedRevision, patch: { externalCandidates } }, actor);
  }

  async setHumanReview(id, { expectedRevision, stageId, contentHash, decision, rationale = "" }, actor) {
    const normalizedActor = normalizeActor(actor, { type: "human", name: "local-user", channel: "web" });
    if (normalizedActor.type !== "human") throw new Error("human-review-required");
    if (!["confirmed", "partial", "excluded", "unreviewed"].includes(decision)) throw new Error("invalid-review-decision");
    const current = await this.getWorkflow(id);
    if (!current.stages.some((stage) => stage.id === stageId)) throw new Error("workflow-stage-not-found");
    const reviews = structuredClone(current.reviews || {});
    reviews[stageId] ||= {};
    if (decision === "unreviewed") delete reviews[stageId][contentHash];
    else {
      reviews[stageId][contentHash] = {
        decision,
        rationale: String(rationale || "").slice(0, 1_000),
        actor: normalizedActor,
        updatedAt: new Date().toISOString(),
      };
    }
    if (!Object.keys(reviews[stageId]).length) delete reviews[stageId];
    return this.updateWorkflow(id, { expectedRevision, patch: { reviews } }, normalizedActor);
  }

  async setHumanValidation(id, { expectedRevision, contentHash, agent, environment, skillVersion, notes }, actor) {
    const normalizedActor = normalizeActor(actor, { type: "human", name: "local-user", channel: "web" });
    if (normalizedActor.type !== "human") throw new Error("human-validation-required");
    const current = await this.getWorkflow(id);
    const validations = structuredClone(current.validations || {});
    validations[contentHash] = {
      status: "human-verified",
      agent: String(agent || "").slice(0, 200),
      environment: String(environment || "").slice(0, 500),
      skillVersion: String(skillVersion || "").slice(0, 100),
      notes: String(notes || "").slice(0, 1_000),
      actor: normalizedActor,
      updatedAt: new Date().toISOString(),
    };
    return this.updateWorkflow(id, { expectedRevision, patch: { validations } }, normalizedActor);
  }

  async confirmWorkflow(id, { expectedRevision, assessmentSnapshot = null }, actor) {
    const normalizedActor = normalizeActor(actor, { type: "human", name: "local-user", channel: "web" });
    if (normalizedActor.type !== "human") throw new Error("human-confirmation-required");
    return this.#mutate((data) => {
      const index = data.workflows.findIndex((item) => item.id === id);
      if (index < 0) throw new WorkflowNotFoundError();
      const current = data.workflows[index];
      ensureExpectedRevision(current, expectedRevision);
      assertConfirmable(current);
      const now = new Date().toISOString();
      const version = Math.max(
        current.confirmedVersion || 0,
        ...data.confirmations.filter((item) => item.workflowId === id).map((item) => item.version),
      ) + 1;
      const confirmed = {
        ...current,
        status: "confirmed",
        revision: current.revision + 1,
        confirmedVersion: version,
        baseConfirmationVersion: version,
        confirmedAt: now,
        confirmedBy: normalizedActor,
        updatedAt: now,
        updatedBy: normalizedActor,
      };
      const snapshot = structuredClone(confirmed);
      data.confirmations.push({
        id: crypto.randomUUID(),
        workflowId: id,
        version,
        workflowRevision: confirmed.revision,
        confirmedAt: now,
        confirmedBy: normalizedActor,
        snapshot,
        assessment: assessmentSnapshot ? structuredClone(assessmentSnapshot) : null,
      });
      data.workflows[index] = confirmed;
      data.events.push(event("workflow.confirmed", confirmed, normalizedActor, { version }));
      return publicWorkflow(confirmed);
    });
  }

  async getConfirmation(id, version, { redactSensitive = false } = {}) {
    const data = await this.#readUnlocked();
    const confirmation = data.confirmations.find((item) => item.workflowId === id && item.version === Number(version));
    if (!confirmation) throw new WorkflowNotFoundError();
    const result = structuredClone(confirmation);
    if (redactSensitive && result.snapshot) result.snapshot = publicWorkflow(result.snapshot, { redactSensitive: true });
    return result;
  }

  async getProjectBrief(workflowId, { includeHistory = false } = {}) {
    const data = await this.#readUnlocked();
    const brief = data.projectBriefs.find((item) => item.workflowId === workflowId);
    if (!brief) throw new Error("project-brief-not-found");
    const result = publicProjectBrief(brief);
    if (includeHistory) {
      result.history = data.projectBriefConfirmations
        .filter((item) => item.workflowId === workflowId)
        .map(({ snapshot, ...metadata }) => metadata)
        .sort((left, right) => right.version - left.version);
    }
    return result;
  }

  async createProjectBrief(workflowId, input, actor = { type: "agent", name: "unknown-agent", channel: "mcp" }) {
    const normalizedActor = normalizeActor(actor);
    return this.#mutate((data) => {
      const workflow = data.workflows.find((item) => item.id === workflowId);
      if (!workflow) throw new WorkflowNotFoundError();
      if (data.projectBriefs.some((item) => item.workflowId === workflowId)) {
        throw new Error("project-brief-already-exists");
      }
      if (data.projectBriefs.length >= MAX_PROJECT_BRIEFS) throw new Error("too-many-project-briefs");
      const brief = normalizeProjectBriefInput({
        ...input,
        workflowId,
        status: "draft",
        createdBy: normalizedActor,
        updatedBy: normalizedActor,
      }, { workflowId });
      data.projectBriefs.push(brief);
      data.events.push(event("project-brief.created", workflow, normalizedActor, { briefId: brief.id }));
      return publicProjectBrief(brief);
    });
  }

  async updateProjectBrief(workflowId, { expectedRevision, patch }, actor = { type: "agent", name: "unknown-agent", channel: "mcp" }) {
    const normalizedActor = normalizeActor(actor);
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("project-brief-patch-required");
    return this.#mutate((data) => {
      const workflow = data.workflows.find((item) => item.id === workflowId);
      if (!workflow) throw new WorkflowNotFoundError();
      const index = data.projectBriefs.findIndex((item) => item.workflowId === workflowId);
      if (index < 0) throw new Error("project-brief-not-found");
      const current = data.projectBriefs[index];
      ensureExpectedRevision(current, expectedRevision);
      const wasFrozen = current.status === "frozen";
      const now = new Date().toISOString();
      const candidate = normalizeProjectBriefInput({
        ...current,
        ...patch,
        workflowId,
        status: wasFrozen ? "draft" : current.status,
        baseFrozenVersion: wasFrozen ? current.frozenVersion : current.baseFrozenVersion,
        createdBy: current.createdBy,
        updatedBy: normalizedActor,
      }, {
        id: current.id,
        workflowId,
        revision: current.revision + 1,
        timestamps: { createdAt: current.createdAt, updatedAt: now },
      });
      data.projectBriefs[index] = candidate;
      data.events.push(event(wasFrozen ? "project-brief.revision-started" : "project-brief.updated", workflow, normalizedActor, {
        briefId: candidate.id,
        briefRevision: candidate.revision,
      }));
      return publicProjectBrief(candidate);
    });
  }

  async freezeProjectBrief(workflowId, { expectedRevision }, actor) {
    const normalizedActor = normalizeActor(actor, { type: "human", name: "local-user", channel: "web" });
    if (normalizedActor.type !== "human") throw new Error("human-project-brief-freeze-required");
    return this.#mutate((data) => {
      const workflow = data.workflows.find((item) => item.id === workflowId);
      if (!workflow) throw new WorkflowNotFoundError();
      const index = data.projectBriefs.findIndex((item) => item.workflowId === workflowId);
      if (index < 0) throw new Error("project-brief-not-found");
      const current = data.projectBriefs[index];
      ensureExpectedRevision(current, expectedRevision);
      assertProjectBriefFreezable(current);
      const now = new Date().toISOString();
      const version = Math.max(
        current.frozenVersion || 0,
        ...data.projectBriefConfirmations.filter((item) => item.workflowId === workflowId).map((item) => item.version),
      ) + 1;
      const frozen = {
        ...current,
        status: "frozen",
        revision: current.revision + 1,
        frozenVersion: version,
        baseFrozenVersion: version,
        frozenAt: now,
        frozenBy: normalizedActor,
        updatedAt: now,
        updatedBy: normalizedActor,
      };
      data.projectBriefConfirmations.push({
        id: crypto.randomUUID(),
        workflowId,
        briefId: frozen.id,
        version,
        briefRevision: frozen.revision,
        frozenAt: now,
        frozenBy: normalizedActor,
        snapshot: structuredClone(frozen),
      });
      data.projectBriefs[index] = frozen;
      data.events.push(event("project-brief.frozen", workflow, normalizedActor, {
        briefId: frozen.id,
        version,
      }));
      return publicProjectBrief(frozen);
    });
  }

  async getProjectBriefVersion(workflowId, version) {
    const data = await this.#readUnlocked();
    const confirmation = data.projectBriefConfirmations.find((item) =>
      item.workflowId === workflowId && item.version === Number(version));
    if (!confirmation) throw new Error("project-brief-version-not-found");
    return structuredClone(confirmation);
  }

  async getPlaybook(workflowId, { includeHistory = false } = {}) {
    const data = await this.#readUnlocked();
    const playbook = data.playbooks.find((item) => item.workflowId === workflowId);
    if (!playbook) throw new Error("playbook-not-found");
    const result = publicPlaybook(playbook);
    if (includeHistory) {
      result.history = data.playbookConfirmations
        .filter((item) => item.workflowId === workflowId)
        .map(({ snapshot, ...metadata }) => metadata)
        .sort((left, right) => right.version - left.version);
    }
    return result;
  }

  async createPlaybook(workflowId, input, actor = { type: "agent", name: "unknown-agent", channel: "mcp" }) {
    const normalizedActor = normalizeActor(actor);
    return this.#mutate((data) => {
      const workflow = data.workflows.find((item) => item.id === workflowId);
      if (!workflow) throw new WorkflowNotFoundError();
      if (data.playbooks.some((item) => item.workflowId === workflowId)) throw new Error("playbook-already-exists");
      if (data.playbooks.length >= MAX_PLAYBOOKS) throw new Error("too-many-playbooks");
      const briefVersion = Number(input?.source?.projectBriefVersion);
      if (!data.projectBriefConfirmations.some((item) => item.workflowId === workflowId && item.version === briefVersion)) {
        throw new Error("playbook-project-brief-version-not-found");
      }
      const playbook = normalizePlaybookInput({
        ...input,
        workflowId,
        status: "draft",
        createdBy: normalizedActor,
        updatedBy: normalizedActor,
      }, { workflowId });
      data.playbooks.push(playbook);
      data.events.push(event("playbook.created", workflow, normalizedActor, { playbookId: playbook.id }));
      return publicPlaybook(playbook);
    });
  }

  async updatePlaybook(workflowId, { expectedRevision, patch }, actor = { type: "agent", name: "unknown-agent", channel: "mcp" }) {
    const normalizedActor = normalizeActor(actor);
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("playbook-patch-required");
    return this.#mutate((data) => {
      const workflow = data.workflows.find((item) => item.id === workflowId);
      if (!workflow) throw new WorkflowNotFoundError();
      const index = data.playbooks.findIndex((item) => item.workflowId === workflowId);
      if (index < 0) throw new Error("playbook-not-found");
      const current = data.playbooks[index];
      ensureExpectedRevision(current, expectedRevision);
      if (patch.stages) {
        const incomingIds = new Set(patch.stages.map((stage) => String(stage?.id || "")));
        const removed = current.stages.find((stage) => !incomingIds.has(stage.id));
        if (removed) throw new Error(`playbook-stage-removal-not-allowed:${removed.id}`);
      }
      const wasConfirmed = current.status === "confirmed";
      const now = new Date().toISOString();
      const candidate = normalizePlaybookInput({
        ...current,
        ...patch,
        workflowId,
        status: wasConfirmed ? "draft" : current.status,
        verificationLevel: "agent-generated",
        baseConfirmationVersion: wasConfirmed ? current.confirmedVersion : current.baseConfirmationVersion,
        createdBy: current.createdBy,
        updatedBy: normalizedActor,
      }, {
        id: current.id,
        workflowId,
        revision: current.revision + 1,
        timestamps: { createdAt: current.createdAt, updatedAt: now },
      });
      const briefVersion = candidate.source.projectBriefVersion;
      if (!data.projectBriefConfirmations.some((item) => item.workflowId === workflowId && item.version === briefVersion)) {
        throw new Error("playbook-project-brief-version-not-found");
      }
      data.playbooks[index] = candidate;
      data.events.push(event(wasConfirmed ? "playbook.revision-started" : "playbook.updated", workflow, normalizedActor, {
        playbookId: candidate.id,
        playbookRevision: candidate.revision,
      }));
      return publicPlaybook(candidate);
    });
  }

  async confirmPlaybook(workflowId, { expectedRevision, reviewedContentHash }, actor) {
    const normalizedActor = normalizeActor(actor, { type: "human", name: "local-user", channel: "web" });
    if (normalizedActor.type !== "human") throw new Error("human-playbook-confirmation-required");
    return this.#mutate((data) => {
      const workflow = data.workflows.find((item) => item.id === workflowId);
      if (!workflow) throw new WorkflowNotFoundError();
      const index = data.playbooks.findIndex((item) => item.workflowId === workflowId);
      if (index < 0) throw new Error("playbook-not-found");
      const current = data.playbooks[index];
      ensureExpectedRevision(current, expectedRevision);
      const currentContentHash = publicPlaybook(current).contentHash;
      if (!reviewedContentHash || reviewedContentHash !== currentContentHash) {
        throw new Error("playbook-review-hash-required");
      }
      const reviewed = { ...current, verificationLevel: "maintainer-reviewed" };
      assertPlaybookConfirmable(reviewed);
      const now = new Date().toISOString();
      const version = Math.max(
        current.confirmedVersion || 0,
        ...data.playbookConfirmations.filter((item) => item.workflowId === workflowId).map((item) => item.version),
      ) + 1;
      const confirmed = {
        ...reviewed,
        status: "confirmed",
        revision: current.revision + 1,
        confirmedVersion: version,
        baseConfirmationVersion: version,
        confirmedAt: now,
        confirmedBy: normalizedActor,
        updatedAt: now,
        updatedBy: normalizedActor,
      };
      data.playbookConfirmations.push({
        id: crypto.randomUUID(),
        workflowId,
        playbookId: confirmed.id,
        version,
        playbookRevision: confirmed.revision,
        confirmedAt: now,
        confirmedBy: normalizedActor,
        contentHash: publicPlaybook(confirmed).contentHash,
        snapshot: structuredClone(confirmed),
      });
      data.playbooks[index] = confirmed;
      data.events.push(event("playbook.confirmed", workflow, normalizedActor, {
        playbookId: confirmed.id,
        version,
      }));
      return publicPlaybook(confirmed);
    });
  }

  async getPlaybookDiff(workflowId) {
    const data = await this.#readUnlocked();
    const playbook = data.playbooks.find((item) => item.workflowId === workflowId);
    if (!playbook) throw new Error("playbook-not-found");
    const baseVersion = playbook.status === "confirmed"
      ? playbook.confirmedVersion
      : playbook.baseConfirmationVersion;
    const base = baseVersion
      ? data.playbookConfirmations.find((item) => item.workflowId === workflowId && item.version === baseVersion)?.snapshot || null
      : null;
    return diffPlaybooks(playbook, base);
  }

  async getPlaybookVersion(workflowId, version) {
    const data = await this.#readUnlocked();
    const confirmation = data.playbookConfirmations.find((item) =>
      item.workflowId === workflowId && item.version === Number(version));
    if (!confirmation) throw new Error("playbook-version-not-found");
    const result = structuredClone(confirmation);
    if (result.snapshot) result.snapshot = publicPlaybook(result.snapshot);
    return result;
  }

  async getPlaybookProgress(workflowId) {
    const data = await this.#readUnlocked();
    const playbook = data.playbooks.find((item) => item.workflowId === workflowId);
    if (!playbook) throw new Error("playbook-not-found");
    const playbookView = publicPlaybook(playbook);
    const sessions = data.playbookProgress
      .filter((item) => item.playbookId === playbook.id)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const current = sessions.find((item) => item.playbookContentHash === playbookView.contentHash) || null;
    return {
      workflowId,
      playbookId: playbook.id,
      playbookRevision: playbook.revision,
      playbookContentHash: playbookView.contentHash,
      current: current ? publicPlaybookProgress(current) : null,
      summary: progressSummary(playbook, current),
      staleSessions: sessions.filter((item) => item.playbookContentHash !== playbookView.contentHash).map((item) => ({
        id: item.id,
        revision: item.revision,
        playbookRevision: item.playbookRevision,
        playbookContentHash: item.playbookContentHash,
        updatedAt: item.updatedAt,
        summary: progressSummary(playbook, item),
      })),
    };
  }

  async getPlaybookVerification(workflowId) {
    const data = await this.#readUnlocked();
    const playbook = data.playbooks.find((item) => item.workflowId === workflowId);
    if (!playbook) throw new Error("playbook-not-found");
    return playbookVerificationView(data, playbook);
  }

  async verifyPlaybook(workflowId, {
    expectedRevision,
    reviewedContentHash,
    level,
    summary,
    sampleName,
    environment,
    testerProfile,
    assistanceLevel,
    blockers = [],
    evidence = [],
  }, actor) {
    const normalizedActor = normalizeActor(actor, { type: "human", name: "local-user", channel: "web" });
    if (normalizedActor.type !== "human") throw new Error("human-playbook-verification-required");
    return this.#mutate((data) => {
      const workflow = data.workflows.find((item) => item.id === workflowId);
      if (!workflow) throw new WorkflowNotFoundError();
      const index = data.playbooks.findIndex((item) => item.workflowId === workflowId);
      if (index < 0) throw new Error("playbook-not-found");
      const current = data.playbooks[index];
      ensureExpectedRevision(current, expectedRevision);
      if (current.status !== "confirmed") throw new Error("confirmed-playbook-verification-required");
      const currentContentHash = publicPlaybook(current).contentHash;
      if (!reviewedContentHash || reviewedContentHash !== currentContentHash) {
        throw new Error("playbook-verification-hash-required");
      }
      const requiredLevel = nextVerificationLevel(current.verificationLevel);
      if (level !== requiredLevel || !new Set(["sample-run", "novice-validated"]).has(level)) {
        throw new Error(`playbook-verification-order-required:${requiredLevel || "complete"}`);
      }
      const progress = data.playbookProgress.find((item) =>
        item.playbookId === current.id && item.playbookContentHash === currentContentHash) || null;
      const readiness = sampleRunReadiness(current, progress);
      if (level === "sample-run" && !readiness.eligible) throw new Error("playbook-sample-run-incomplete");
      const currentRecords = data.playbookVerifications.filter((item) =>
        item.playbookId === current.id && item.playbookContentHash === currentContentHash);
      const previous = level === "novice-validated"
        ? currentRecords.find((item) => item.level === "sample-run")
        : null;
      if (level === "novice-validated" && !previous) throw new Error("playbook-sample-run-verification-required");
      if (data.playbookVerifications.length >= MAX_PLAYBOOK_VERIFICATION_RECORDS) {
        throw new Error("too-many-playbook-verification-records");
      }
      const now = new Date().toISOString();
      const record = normalizePlaybookVerificationInput({
        level,
        summary,
        sampleName,
        environment,
        testerProfile,
        assistanceLevel,
        blockers,
        evidence,
      }, {
        workflowId,
        playbookId: current.id,
        playbookContentHash: currentContentHash,
        playbookVersion: current.confirmedVersion,
        playbookRevision: current.revision,
        progressId: progress?.id || null,
        progressRevision: progress?.revision || null,
        previousVerificationId: previous?.id || null,
        verifiedAt: now,
        verifiedBy: normalizedActor,
      });
      const updated = normalizePlaybookInput({
        ...current,
        verificationLevel: level,
        updatedBy: normalizedActor,
      }, {
        id: current.id,
        workflowId,
        revision: current.revision + 1,
        timestamps: { createdAt: current.createdAt, updatedAt: now },
      });
      if (publicPlaybook(updated).contentHash !== currentContentHash) throw new Error("playbook-verification-content-changed");
      data.playbookVerifications.push(record);
      data.playbooks[index] = updated;
      data.events.push(event(`playbook.verification.${level}`, workflow, normalizedActor, {
        playbookId: current.id,
        playbookVersion: current.confirmedVersion,
        playbookContentHash: currentContentHash,
        verificationId: record.id,
      }));
      return {
        playbook: publicPlaybook(updated),
        verification: publicPlaybookVerification(record),
      };
    });
  }

  async startPlaybookProgress(workflowId, actor) {
    const normalizedActor = normalizeActor(actor, { type: "human", name: "local-user", channel: "web" });
    if (normalizedActor.type !== "human") throw new Error("human-playbook-progress-required");
    return this.#mutate((data) => {
      const workflow = data.workflows.find((item) => item.id === workflowId);
      if (!workflow) throw new WorkflowNotFoundError();
      const playbook = data.playbooks.find((item) => item.workflowId === workflowId);
      if (!playbook) throw new Error("playbook-not-found");
      if (playbook.status !== "confirmed") throw new Error("confirmed-playbook-progress-required");
      const contentHash = publicPlaybook(playbook).contentHash;
      const current = data.playbookProgress.find((item) =>
        item.playbookId === playbook.id && item.playbookContentHash === contentHash);
      if (current) return publicPlaybookProgress(current);
      if (data.playbookProgress.length >= MAX_PLAYBOOK_PROGRESS_RECORDS) throw new Error("too-many-playbook-progress-sessions");
      const progress = normalizePlaybookProgressInput({
        workflowId,
        playbookId: playbook.id,
        playbookContentHash: contentHash,
        playbookRevision: playbook.revision,
        steps: [],
        gates: [],
        createdBy: normalizedActor,
        updatedBy: normalizedActor,
      }, {
        workflowId,
        playbookId: playbook.id,
        playbookContentHash: contentHash,
      });
      data.playbookProgress.push(progress);
      data.events.push(event("playbook-progress.started", workflow, normalizedActor, {
        playbookId: playbook.id,
        progressId: progress.id,
        playbookContentHash: contentHash,
      }));
      return publicPlaybookProgress(progress);
    });
  }

  async updatePlaybookStepProgress(workflowId, {
    expectedRevision,
    stageId,
    stepId,
    status,
    acceptanceResult = "pending",
    notes = "",
    evidence = [],
  }, actor) {
    const normalizedActor = normalizeActor(actor, { type: "human", name: "local-user", channel: "web" });
    if (normalizedActor.type !== "human") throw new Error("human-playbook-progress-required");
    if (!stageId || !stepId) throw new Error("playbook-progress-step-required");
    if (!["not-started", "in-progress", "completed"].includes(status)) throw new Error("playbook-progress-status-invalid");
    if (!["pending", "passed", "failed"].includes(acceptanceResult)) throw new Error("playbook-progress-acceptance-invalid");
    return this.#mutate((data) => {
      const workflow = data.workflows.find((item) => item.id === workflowId);
      if (!workflow) throw new WorkflowNotFoundError();
      const playbook = data.playbooks.find((item) => item.workflowId === workflowId);
      if (!playbook) throw new Error("playbook-not-found");
      const contentHash = publicPlaybook(playbook).contentHash;
      const index = data.playbookProgress.findIndex((item) =>
        item.playbookId === playbook.id && item.playbookContentHash === contentHash);
      if (index < 0) throw new Error("playbook-progress-not-started");
      const current = data.playbookProgress[index];
      ensureExpectedRevision(current, expectedRevision);
      const { stage } = playbookStageAndStep(playbook, stageId, stepId);
      if (stage.applicability === "not-applicable") throw new Error("playbook-stage-not-applicable");
      for (const dependencyId of stage.dependencies || []) {
        const gate = current.gates.find((item) => item.stageId === dependencyId);
        if (!gate || !["passed", "not-applicable"].includes(gate.status)) {
          throw new Error(`playbook-stage-dependency-gate-open:${stageId}:${dependencyId}`);
        }
      }
      const cleanEvidence = normalizeProgressEvidence(evidence);
      if (status === "completed" && acceptanceResult !== "passed") {
        throw new Error("playbook-step-completion-requires-acceptance");
      }
      if (status === "completed" && stage.qualityGate.level === "hard" && !cleanEvidence.length) {
        throw new Error("playbook-step-completion-requires-evidence");
      }
      const now = new Date().toISOString();
      const steps = structuredClone(current.steps || []);
      const existing = steps.findIndex((item) => item.stageId === stageId && item.stepId === stepId);
      const record = {
        stageId,
        stepId,
        status,
        acceptanceResult,
        notes: String(notes || "").slice(0, 4_000),
        evidence: cleanEvidence,
        updatedAt: now,
        updatedBy: normalizedActor,
      };
      if (existing >= 0) steps[existing] = record;
      else steps.push(record);
      const updated = normalizePlaybookProgressInput({
        ...current,
        steps,
        updatedBy: normalizedActor,
      }, {
        id: current.id,
        workflowId,
        playbookId: playbook.id,
        playbookContentHash: contentHash,
        revision: current.revision + 1,
        timestamps: { createdAt: current.createdAt, updatedAt: now },
      });
      data.playbookProgress[index] = updated;
      data.events.push(event("playbook-progress.step-updated", workflow, normalizedActor, {
        playbookId: playbook.id,
        progressId: updated.id,
        stageId,
        stepId,
        status,
      }));
      return publicPlaybookProgress(updated);
    });
  }

  async setPlaybookGateProgress(workflowId, {
    expectedRevision,
    stageId,
    status,
    rationale = "",
    evidence = [],
  }, actor) {
    const normalizedActor = normalizeActor(actor, { type: "human", name: "local-user", channel: "web" });
    if (normalizedActor.type !== "human") throw new Error("human-playbook-progress-required");
    if (!["pending", "passed", "failed", "not-applicable"].includes(status)) throw new Error("playbook-gate-status-invalid");
    return this.#mutate((data) => {
      const workflow = data.workflows.find((item) => item.id === workflowId);
      if (!workflow) throw new WorkflowNotFoundError();
      const playbook = data.playbooks.find((item) => item.workflowId === workflowId);
      if (!playbook) throw new Error("playbook-not-found");
      const stage = playbook.stages.find((item) => item.id === stageId);
      if (!stage) throw new Error("playbook-stage-not-found");
      const contentHash = publicPlaybook(playbook).contentHash;
      const index = data.playbookProgress.findIndex((item) =>
        item.playbookId === playbook.id && item.playbookContentHash === contentHash);
      if (index < 0) throw new Error("playbook-progress-not-started");
      const current = data.playbookProgress[index];
      ensureExpectedRevision(current, expectedRevision);
      const cleanRationale = String(rationale || "").trim().slice(0, 4_000);
      if (["passed", "failed", "not-applicable"].includes(status) && !cleanRationale) {
        throw new Error("playbook-gate-rationale-required");
      }
      if (status === "not-applicable" && stage.applicability !== "not-applicable") {
        throw new Error("playbook-stage-na-definition-required");
      }
      if (status === "passed") {
        const records = stage.steps.map((step) => current.steps.find((item) =>
          item.stageId === stageId && item.stepId === step.id));
        if (records.some((record) => !record || record.status !== "completed"
          || record.acceptanceResult !== "passed"
          || (stage.qualityGate.level === "hard" && !record.evidence.length))) {
          throw new Error(`playbook-stage-gate-incomplete:${stageId}`);
        }
      }
      const now = new Date().toISOString();
      const gates = structuredClone(current.gates || []);
      const existing = gates.findIndex((item) => item.stageId === stageId);
      const record = {
        stageId,
        status,
        rationale: cleanRationale,
        evidence: normalizeProgressEvidence(evidence),
        updatedAt: now,
        updatedBy: normalizedActor,
      };
      if (existing >= 0) gates[existing] = record;
      else gates.push(record);
      const updated = normalizePlaybookProgressInput({
        ...current,
        gates,
        updatedBy: normalizedActor,
      }, {
        id: current.id,
        workflowId,
        playbookId: playbook.id,
        playbookContentHash: contentHash,
        revision: current.revision + 1,
        timestamps: { createdAt: current.createdAt, updatedAt: now },
      });
      data.playbookProgress[index] = updated;
      data.events.push(event("playbook-progress.gate-updated", workflow, normalizedActor, {
        playbookId: playbook.id,
        progressId: updated.id,
        stageId,
        status,
      }));
      return publicPlaybookProgress(updated);
    });
  }

  async exportData() {
    return this.read();
  }

  async importData(value, actor = { type: "human", name: "local-user", channel: "web" }) {
    const rawSource = value?.data && typeof value.data === "object" ? value.data : value;
    if (!rawSource || rawSource.schemaVersion !== "1" || !Array.isArray(rawSource.workflows)) {
      throw new Error("workflow-backup-invalid");
    }
    const source = Number(rawSource.playbookContentHashVersion) >= PLAYBOOK_CONTENT_HASH_VERSION
      ? rawSource
      : migrateLegacyPlaybookHashes(structuredClone(rawSource));
    if (source.workflows.length > 500) throw new Error("too-many-workflows");
    const normalizedActor = normalizeActor(actor, { type: "human", name: "local-user", channel: "web" });
    return this.#mutate((data) => {
      if (data.workflows.length + source.workflows.length > 1_000) throw new Error("too-many-workflows");
      const idMap = new Map();
      let imported = 0;
      let skipped = 0;
      for (const raw of source.workflows) {
        const requestedId = String(raw.id || crypto.randomUUID()).slice(0, 200);
        const current = data.workflows.find((item) => item.id === requestedId);
        const exactDuplicate = current && JSON.stringify(current) === JSON.stringify(raw);
        if (exactDuplicate) {
          idMap.set(requestedId, requestedId);
          skipped += 1;
          continue;
        }
        const id = current ? crypto.randomUUID() : requestedId;
        const workflow = normalizeWorkflowInput({
          ...raw,
          id,
          goal: current ? `${raw.goal || "导入工作流"}（导入）` : raw.goal,
          updatedBy: current ? normalizedActor : raw.updatedBy,
        }, {
          id,
          revision: Math.max(1, Number(raw.revision) || 1),
          timestamps: {
            createdAt: raw.createdAt || new Date().toISOString(),
            updatedAt: raw.updatedAt || new Date().toISOString(),
          },
        });
        data.workflows.push(workflow);
        idMap.set(requestedId, id);
        data.events.push(event("workflow.imported", workflow, normalizedActor, { sourceWorkflowId: requestedId }));
        imported += 1;
      }

      let confirmationVersions = 0;
      for (const raw of Array.isArray(source.confirmations) ? source.confirmations.slice(-MAX_CONFIRMATIONS) : []) {
        const workflowId = idMap.get(String(raw.workflowId || ""));
        if (!workflowId || !raw.snapshot || !Number.isInteger(Number(raw.version))) continue;
        const duplicate = data.confirmations.some((item) =>
          item.workflowId === workflowId && item.version === Number(raw.version) && JSON.stringify(item.snapshot) === JSON.stringify(raw.snapshot));
        if (duplicate) continue;
        const workflow = data.workflows.find((item) => item.id === workflowId);
        const version = data.confirmations.some((item) => item.workflowId === workflowId && item.version === Number(raw.version))
          ? Math.max(0, ...data.confirmations.filter((item) => item.workflowId === workflowId).map((item) => item.version)) + 1
          : Number(raw.version);
        const snapshot = normalizeWorkflowInput({
          ...raw.snapshot,
          id: workflowId,
          status: "confirmed",
          confirmedVersion: version,
        }, {
          id: workflowId,
          revision: Math.max(1, Number(raw.snapshot.revision) || workflow.revision),
          timestamps: {
            createdAt: raw.snapshot.createdAt || workflow.createdAt,
            updatedAt: raw.snapshot.updatedAt || raw.confirmedAt || workflow.updatedAt,
          },
        });
        data.confirmations.push({
          id: crypto.randomUUID(),
          workflowId,
          version,
          workflowRevision: snapshot.revision,
          confirmedAt: raw.confirmedAt || snapshot.confirmedAt || new Date().toISOString(),
          confirmedBy: raw.confirmedBy ? normalizeActor(raw.confirmedBy) : normalizedActor,
          snapshot,
          assessment: raw.assessment ? structuredClone(raw.assessment) : null,
        });
        confirmationVersions += 1;
      }

      const briefIdMap = new Map();
      for (const raw of Array.isArray(source.projectBriefs) ? source.projectBriefs.slice(0, MAX_PROJECT_BRIEFS) : []) {
        const sourceWorkflowId = String(raw.workflowId || "");
        const workflowId = idMap.get(sourceWorkflowId);
        if (!workflowId) continue;
        const current = data.projectBriefs.find((item) => item.workflowId === workflowId);
        if (current) {
          briefIdMap.set(String(raw.id || ""), current.id);
          continue;
        }
        const requestedId = String(raw.id || crypto.randomUUID()).slice(0, 200);
        const id = data.projectBriefs.some((item) => item.id === requestedId) ? crypto.randomUUID() : requestedId;
        const brief = normalizeProjectBriefInput({
          ...raw,
          id,
          workflowId,
        }, {
          id,
          workflowId,
          revision: Math.max(1, Number(raw.revision) || 1),
          timestamps: {
            createdAt: raw.createdAt || new Date().toISOString(),
            updatedAt: raw.updatedAt || new Date().toISOString(),
          },
        });
        data.projectBriefs.push(brief);
        briefIdMap.set(requestedId, id);
      }

      for (const raw of Array.isArray(source.projectBriefConfirmations)
        ? source.projectBriefConfirmations.slice(-MAX_CONFIRMATIONS)
        : []) {
        const workflowId = idMap.get(String(raw.workflowId || ""));
        const briefId = briefIdMap.get(String(raw.briefId || raw.snapshot?.id || ""));
        if (!workflowId || !briefId || !raw.snapshot || !Number.isInteger(Number(raw.version))) continue;
        const duplicate = data.projectBriefConfirmations.some((item) =>
          item.workflowId === workflowId && item.version === Number(raw.version));
        if (duplicate) continue;
        const version = Number(raw.version);
        const snapshot = normalizeProjectBriefInput({
          ...raw.snapshot,
          id: briefId,
          workflowId,
          status: "frozen",
          frozenVersion: version,
        }, {
          id: briefId,
          workflowId,
          revision: Math.max(1, Number(raw.snapshot.revision) || 1),
          timestamps: {
            createdAt: raw.snapshot.createdAt || new Date().toISOString(),
            updatedAt: raw.snapshot.updatedAt || raw.frozenAt || new Date().toISOString(),
          },
        });
        data.projectBriefConfirmations.push({
          id: crypto.randomUUID(),
          workflowId,
          briefId,
          version,
          briefRevision: snapshot.revision,
          frozenAt: raw.frozenAt || snapshot.frozenAt || new Date().toISOString(),
          frozenBy: raw.frozenBy ? normalizeActor(raw.frozenBy) : normalizedActor,
          snapshot,
        });
      }

      const playbookIdMap = new Map();
      for (const raw of Array.isArray(source.playbooks) ? source.playbooks.slice(0, MAX_PLAYBOOKS) : []) {
        const workflowId = idMap.get(String(raw.workflowId || raw.source?.workflowId || ""));
        if (!workflowId) continue;
        const current = data.playbooks.find((item) => item.workflowId === workflowId);
        if (current) {
          playbookIdMap.set(String(raw.id || ""), current.id);
          continue;
        }
        const requestedId = String(raw.id || crypto.randomUUID()).slice(0, 200);
        const id = data.playbooks.some((item) => item.id === requestedId) ? crypto.randomUUID() : requestedId;
        const playbook = normalizePlaybookInput({
          ...raw,
          id,
          workflowId,
          source: {
            ...(raw.source || {}),
            workflowId,
            projectBriefId: briefIdMap.get(String(raw.source?.projectBriefId || "")) || raw.source?.projectBriefId,
          },
        }, {
          id,
          workflowId,
          revision: Math.max(1, Number(raw.revision) || 1),
          timestamps: {
            createdAt: raw.createdAt || new Date().toISOString(),
            updatedAt: raw.updatedAt || new Date().toISOString(),
          },
        });
        data.playbooks.push(playbook);
        playbookIdMap.set(requestedId, id);
      }

      for (const raw of Array.isArray(source.playbookConfirmations)
        ? source.playbookConfirmations.slice(-MAX_CONFIRMATIONS)
        : []) {
        const workflowId = idMap.get(String(raw.workflowId || ""));
        const playbookId = playbookIdMap.get(String(raw.playbookId || raw.snapshot?.id || ""));
        if (!workflowId || !playbookId || !raw.snapshot || !Number.isInteger(Number(raw.version))) continue;
        const duplicate = data.playbookConfirmations.some((item) =>
          item.workflowId === workflowId && item.version === Number(raw.version));
        if (duplicate) continue;
        const version = Number(raw.version);
        const snapshot = normalizePlaybookInput({
          ...raw.snapshot,
          id: playbookId,
          workflowId,
          status: "confirmed",
          confirmedVersion: version,
          source: {
            ...(raw.snapshot.source || {}),
            workflowId,
            projectBriefId: briefIdMap.get(String(raw.snapshot.source?.projectBriefId || ""))
              || raw.snapshot.source?.projectBriefId,
          },
        }, {
          id: playbookId,
          workflowId,
          revision: Math.max(1, Number(raw.snapshot.revision) || 1),
          timestamps: {
            createdAt: raw.snapshot.createdAt || new Date().toISOString(),
            updatedAt: raw.snapshot.updatedAt || raw.confirmedAt || new Date().toISOString(),
          },
        });
        data.playbookConfirmations.push({
          id: crypto.randomUUID(),
          workflowId,
          playbookId,
          version,
          playbookRevision: snapshot.revision,
          confirmedAt: raw.confirmedAt || snapshot.confirmedAt || new Date().toISOString(),
          confirmedBy: raw.confirmedBy ? normalizeActor(raw.confirmedBy) : normalizedActor,
          contentHash: publicPlaybook(snapshot).contentHash,
          snapshot,
        });
      }

      for (const raw of Array.isArray(source.playbookProgress)
        ? source.playbookProgress.slice(-MAX_PLAYBOOK_PROGRESS_RECORDS)
        : []) {
        const workflowId = idMap.get(String(raw.workflowId || ""));
        const playbookId = playbookIdMap.get(String(raw.playbookId || ""));
        if (!workflowId || !playbookId) continue;
        const importedPlaybook = data.playbooks.find((item) => item.id === playbookId);
        const rawPlaybook = (source.playbooks || []).find((item) => item.id === raw.playbookId);
        const rawCurrentHash = rawPlaybook ? publicPlaybook(rawPlaybook).contentHash : "";
        const playbookContentHash = raw.playbookContentHash === rawCurrentHash && importedPlaybook
          ? publicPlaybook(importedPlaybook).contentHash
          : raw.playbookContentHash;
        if (!playbookContentHash || data.playbookProgress.some((item) =>
          item.playbookId === playbookId && item.playbookContentHash === playbookContentHash)) continue;
        const progress = normalizePlaybookProgressInput({
          ...raw,
          workflowId,
          playbookId,
          playbookContentHash,
        }, {
          id: data.playbookProgress.some((item) => item.id === raw.id) ? crypto.randomUUID() : raw.id,
          workflowId,
          playbookId,
          playbookContentHash,
          revision: Math.max(1, Number(raw.revision) || 1),
          timestamps: {
            createdAt: raw.createdAt || new Date().toISOString(),
            updatedAt: raw.updatedAt || new Date().toISOString(),
          },
        });
        data.playbookProgress.push(progress);
      }

      const verificationIdMap = new Map();
      for (const raw of Array.isArray(source.playbookVerifications)
        ? source.playbookVerifications.slice(-MAX_PLAYBOOK_VERIFICATION_RECORDS)
        : []) {
        const workflowId = idMap.get(String(raw.workflowId || ""));
        const playbookId = playbookIdMap.get(String(raw.playbookId || ""));
        if (!workflowId || !playbookId) continue;
        const importedPlaybook = data.playbooks.find((item) => item.id === playbookId);
        const rawPlaybook = (source.playbooks || []).find((item) => item.id === raw.playbookId);
        const rawCurrentHash = rawPlaybook ? publicPlaybook(rawPlaybook).contentHash : "";
        const playbookContentHash = raw.playbookContentHash === rawCurrentHash && importedPlaybook
          ? publicPlaybook(importedPlaybook).contentHash
          : raw.playbookContentHash;
        if (!playbookContentHash || data.playbookVerifications.some((item) =>
          item.playbookId === playbookId && item.playbookContentHash === playbookContentHash && item.level === raw.level)) continue;
        const importedProgress = data.playbookProgress.find((item) =>
          item.playbookId === playbookId && item.playbookContentHash === playbookContentHash);
        try {
          const record = normalizePlaybookVerificationInput(raw, {
            id: data.playbookVerifications.some((item) => item.id === raw.id) ? crypto.randomUUID() : raw.id,
            workflowId,
            playbookId,
            playbookContentHash,
            playbookVersion: raw.playbookVersion,
            playbookRevision: raw.playbookRevision,
            progressId: importedProgress?.id || null,
            progressRevision: importedProgress?.revision || null,
            previousVerificationId: verificationIdMap.get(String(raw.previousVerificationId || "")) || null,
            verifiedAt: raw.verifiedAt || new Date().toISOString(),
            verifiedBy: raw.verifiedBy ? normalizeActor(raw.verifiedBy) : normalizedActor,
          });
          data.playbookVerifications.push(record);
          verificationIdMap.set(String(raw.id || ""), record.id);
        } catch {
          // Invalid or partial verification evidence is never upgraded during import.
        }
      }
      for (const playbookId of new Set(playbookIdMap.values())) {
        const importedPlaybook = data.playbooks.find((item) => item.id === playbookId);
        if (!importedPlaybook) continue;
        const contentHash = publicPlaybook(importedPlaybook).contentHash;
        const records = data.playbookVerifications.filter((item) =>
          item.playbookId === playbookId && item.playbookContentHash === contentHash);
        importedPlaybook.verificationLevel = importedPlaybook.status === "confirmed" ? "maintainer-reviewed" : "agent-generated";
        if (records.some((item) => item.level === "sample-run")) importedPlaybook.verificationLevel = "sample-run";
        if (records.some((item) => item.level === "novice-validated")) importedPlaybook.verificationLevel = "novice-validated";
      }

      const importedRoots = Array.isArray(source.settings?.customRoots) ? source.settings.customRoots : [];
      data.settings = {
        customRoots: [...new Set([...(data.settings.customRoots || []), ...importedRoots])].slice(0, 20),
        revision: (data.settings.revision || 0) + (importedRoots.length ? 1 : 0),
      };
      return { imported, skipped, confirmationVersions, total: data.workflows.length };
    });
  }
}
