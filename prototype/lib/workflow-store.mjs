import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  applyQuickSkillOperation,
  emptyQuickSkillState,
  normalizeQuickSkillState,
} from "./quick-skill-state.mjs";
import {
  assertConfirmable,
  normalizeActor,
  normalizeStages,
  normalizeWorkflowInput,
  publicWorkflow,
} from "./workflow-model.mjs";

const STORE_SCHEMA_VERSION = "2";
const MAX_STORE_BYTES = 20 * 1024 * 1024;
const MAX_EVENTS = 5_000;
const MAX_CONFIRMATIONS = 1_000;
const MAX_WORKFLOWS = 500;
const LEGACY_EVENT_PREFIXES = ["project-brief.", "playbook.", "playbook-progress.", "playbook-verification."];

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

export class QuickSkillStateConflictError extends Error {
  constructor(currentRevision) {
    super("quick-skill-state-conflict");
    this.name = "QuickSkillStateConflictError";
    this.currentRevision = currentRevision;
  }
}

export class SettingsConflictError extends Error {
  constructor(currentRevision) {
    super("settings-revision-conflict");
    this.name = "SettingsConflictError";
    this.currentRevision = currentRevision;
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
    schemaVersion: STORE_SCHEMA_VERSION,
    revision: 0,
    updatedAt: null,
    settings: { customRoots: [], revision: 0 },
    quickSkillState: emptyQuickSkillState(),
    workflows: [],
    confirmations: [],
    events: [],
  };
}

function supportedEvent(item) {
  const type = String(item?.type || "");
  return !LEGACY_EVENT_PREFIXES.some((prefix) => type.startsWith(prefix));
}

function migrateStore(raw) {
  if (!raw || !["1", STORE_SCHEMA_VERSION].includes(raw.schemaVersion) || !Array.isArray(raw.workflows)) {
    throw new Error("workflow-store-invalid");
  }
  const base = emptyStore();
  return {
    ...base,
    revision: Math.max(0, Number(raw.revision) || 0),
    updatedAt: raw.updatedAt || null,
    settings: { ...base.settings, ...(raw.settings || {}) },
    quickSkillState: normalizeQuickSkillState(raw.quickSkillState),
    workflows: raw.workflows,
    confirmations: Array.isArray(raw.confirmations) ? raw.confirmations : [],
    events: (Array.isArray(raw.events) ? raw.events : []).filter(supportedEvent),
  };
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

export class WorkflowStore {
  constructor({ filePath = defaultStorePath() } = {}) {
    this.filePath = path.resolve(filePath);
    this.lockPath = `${this.filePath}.lock`;
    this.initialization = null;
  }

  async #ensureInitialized() {
    if (!this.initialization) {
      this.initialization = this.initialize().catch((error) => {
        this.initialization = null;
        throw error;
      });
    }
    return this.initialization;
  }

  async #readCurrent() {
    await this.#ensureInitialized();
    return this.#readUnlocked();
  }

  async #readRawUnlocked() {
    try {
      const stats = await fs.stat(this.filePath);
      if (stats.size > MAX_STORE_BYTES) throw new Error("workflow-store-too-large");
      return JSON.parse(await fs.readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return emptyStore();
      throw error;
    }
  }

  async #readUnlocked() {
    return migrateStore(await this.#readRawUnlocked());
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
    data.schemaVersion = STORE_SCHEMA_VERSION;
    data.revision = Math.max(0, Number(data.revision) || 0) + 1;
    data.updatedAt = new Date().toISOString();
    data.events = (data.events || []).filter(supportedEvent).slice(-MAX_EVENTS);
    data.confirmations = (data.confirmations || []).slice(-MAX_CONFIRMATIONS);
    const temporaryPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporaryPath, this.filePath);
  }

  async #mutate(mutator) {
    await this.#ensureInitialized();
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

  async initialize() {
    await this.#acquireLock();
    try {
      const raw = await this.#readRawUnlocked();
      if (raw.schemaVersion === STORE_SCHEMA_VERSION) return { migrated: false, schemaVersion: STORE_SCHEMA_VERSION };
      const removed = {
        projectBriefs: Array.isArray(raw.projectBriefs) ? raw.projectBriefs.length : 0,
        projectBriefConfirmations: Array.isArray(raw.projectBriefConfirmations) ? raw.projectBriefConfirmations.length : 0,
        playbooks: Array.isArray(raw.playbooks) ? raw.playbooks.length : 0,
        playbookConfirmations: Array.isArray(raw.playbookConfirmations) ? raw.playbookConfirmations.length : 0,
        playbookProgress: Array.isArray(raw.playbookProgress) ? raw.playbookProgress.length : 0,
        playbookVerifications: Array.isArray(raw.playbookVerifications) ? raw.playbookVerifications.length : 0,
        playbookContentHashVersions: Array.isArray(raw.playbookContentHashVersions) ? raw.playbookContentHashVersions.length : 0,
      };
      const data = migrateStore(raw);
      data.events.push(event("workspace.schema-v2-migrated", null, {
        type: "migration",
        name: "skill-usage-plan-v1",
        channel: "local-store",
      }, { removed }));
      await this.#writeUnlocked(data);
      return { migrated: true, schemaVersion: STORE_SCHEMA_VERSION, removed };
    } finally {
      await fs.rmdir(this.lockPath).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }

  async read() {
    return structuredClone(await this.#readCurrent());
  }

  async summary() {
    const data = await this.#readCurrent();
    return {
      schemaVersion: data.schemaVersion,
      revision: data.revision,
      updatedAt: data.updatedAt,
      workflows: data.workflows.length,
      drafts: data.workflows.filter((item) => item.status === "draft").length,
      confirmed: data.workflows.filter((item) => item.status === "confirmed").length,
      confirmationVersions: data.confirmations.length,
      skillPlansPersisted: 0,
      dataLocation: "local-user-data",
    };
  }

  async getSettings() {
    return structuredClone((await this.#readCurrent()).settings);
  }

  async updateSettings({ customRoots, expectedRevision }, actor = { type: "human", name: "local-user", channel: "mcp-app" }) {
    if (!Array.isArray(customRoots)) throw new Error("custom-roots-must-be-an-array");
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error("settings-expected-revision-required");
    const roots = [...new Set(customRoots.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 20);
    return this.#mutate((data) => {
      if ((data.settings.revision || 0) !== expectedRevision) throw new SettingsConflictError(data.settings.revision || 0);
      data.settings = { customRoots: roots, revision: (data.settings.revision || 0) + 1 };
      data.events.push(event("settings.updated", null, actor, { customRoots: roots.length }));
      return data.settings;
    });
  }

  async getQuickSkillState() {
    return normalizeQuickSkillState((await this.#readCurrent()).quickSkillState);
  }

  async updateQuickSkillState({ expectedRevision, operation }, actor = { type: "agent", name: "unknown-agent", channel: "mcp" }) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error("quick-skill-expected-revision-required");
    return this.#mutate((data) => {
      const current = normalizeQuickSkillState(data.quickSkillState);
      if (current.revision !== expectedRevision) throw new QuickSkillStateConflictError(current.revision);
      const next = applyQuickSkillOperation(current, operation, data.workflows);
      data.quickSkillState = { ...next, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      data.events.push(event(`quick-skill-state.${operation.type}`, null, actor, {
        workflowId: data.quickSkillState.activeWorkflowId,
        contentHash: operation.contentHash || null,
      }));
      return data.quickSkillState;
    });
  }

  async listWorkflows({ cursor, limit, scope, projectId, status } = {}) {
    const data = await this.#readCurrent();
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
    const data = await this.#readCurrent();
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
    const workflow = normalizeWorkflowInput({ ...input, status: "draft", createdBy: normalizedActor, updatedBy: normalizedActor });
    return this.#mutate((data) => {
      if (data.workflows.length >= MAX_WORKFLOWS) throw new Error("too-many-workflows");
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
    return this.addExternalCandidates(id, { expectedRevision, candidates: [candidate] }, actor);
  }

  async addExternalCandidates(id, { expectedRevision, candidates }, actor = { type: "agent", name: "unknown-agent", channel: "mcp" }) {
    if (!Array.isArray(candidates) || !candidates.length || candidates.length > 100) throw new Error("external-candidates-required");
    const current = await this.getWorkflow(id);
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("external-candidate-required");
      if (!String(candidate.packageId || candidate.package || "").trim() && !String(candidate.sourceUrl || "").trim()) {
        throw new Error("external-candidate-source-required");
      }
      const stage = candidate.stageId ? current.stages.find((item) => item.id === candidate.stageId) : null;
      if (candidate.stageId && !stage) throw new Error("workflow-stage-not-found");
      if (candidate.capabilityId) {
        const exists = stage
          ? stage.capabilities.some((capability) => capability.id === candidate.capabilityId)
          : current.stages.some((item) => item.capabilities.some((capability) => capability.id === candidate.capabilityId));
        if (!exists) throw new Error("workflow-capability-not-found");
      }
    }
    const now = new Date().toISOString();
    const normalizedActor = normalizeActor(actor);
    const externalCandidates = [...(current.externalCandidates || []), ...candidates.map((candidate) => ({
      ...candidate,
      id: crypto.randomUUID(),
      actor: normalizedActor,
      status: candidate.status || "suggested",
      createdAt: now,
      updatedAt: now,
    }))];
    return this.updateWorkflow(id, { expectedRevision, patch: { externalCandidates } }, actor);
  }

  async reviewExternalCandidate(id, {
    expectedRevision,
    candidateId,
    decision,
    reviewedContentHash = "",
    reviewedRepository = "",
    reviewedBranch = "",
    reviewedPath = "",
    reviewedSeverity = "none",
  }, actor) {
    const normalizedActor = normalizeActor(actor, { type: "human", name: "local-user", channel: "mcp-app" });
    if (normalizedActor.type !== "human") throw new Error("human-external-skill-review-required");
    if (!["accepted", "rejected", "suggested"].includes(decision)) throw new Error("external-skill-review-decision-invalid");
    const current = await this.getWorkflow(id);
    const externalCandidates = structuredClone(current.externalCandidates || []);
    const index = externalCandidates.findIndex((candidate) => candidate.id === candidateId);
    if (index < 0) throw new Error("external-skill-candidate-not-found");
    if (externalCandidates[index].status === "installed") throw new Error("installed-external-skill-review-immutable");
    const now = new Date().toISOString();
    const evidence = decision === "suggested" ? {
      reviewedContentHash: "",
      reviewedAt: "",
      reviewedRepository: "",
      reviewedBranch: "",
      reviewedPath: "",
      reviewedSeverity: "none",
    } : {
      reviewedContentHash: String(reviewedContentHash || "").toLowerCase(),
      reviewedAt: now,
      reviewedRepository: String(reviewedRepository || "").slice(0, 500),
      reviewedBranch: String(reviewedBranch || "").slice(0, 200),
      reviewedPath: String(reviewedPath || "").slice(0, 1_000),
      reviewedSeverity: ["none", "low", "medium", "high", "critical"].includes(reviewedSeverity)
        ? reviewedSeverity
        : "none",
    };
    if (decision !== "suggested"
      && (!/^[a-f0-9]{64}$/u.test(evidence.reviewedContentHash)
        || !evidence.reviewedRepository
        || !evidence.reviewedBranch
        || !evidence.reviewedPath)) {
      throw new Error("external-skill-review-evidence-required");
    }
    externalCandidates[index] = {
      ...externalCandidates[index],
      ...evidence,
      status: decision,
      actor: normalizedActor,
      updatedAt: now,
    };
    return this.updateWorkflow(id, { expectedRevision, patch: { externalCandidates } }, normalizedActor);
  }

  async setHumanReview(id, { expectedRevision, stageId, contentHash, decision, rationale = "" }, actor) {
    const normalizedActor = normalizeActor(actor, { type: "human", name: "local-user", channel: "mcp-app" });
    if (normalizedActor.type !== "human") throw new Error("human-review-required");
    if (!["confirmed", "partial", "excluded", "unreviewed"].includes(decision)) throw new Error("invalid-review-decision");
    const current = await this.getWorkflow(id);
    if (!current.stages.some((stage) => stage.id === stageId)) throw new Error("workflow-stage-not-found");
    const reviews = structuredClone(current.reviews || {});
    reviews[stageId] ||= {};
    if (decision === "unreviewed") delete reviews[stageId][contentHash];
    else reviews[stageId][contentHash] = {
      decision,
      rationale: String(rationale || "").slice(0, 1_000),
      actor: normalizedActor,
      updatedAt: new Date().toISOString(),
    };
    if (!Object.keys(reviews[stageId]).length) delete reviews[stageId];
    return this.updateWorkflow(id, { expectedRevision, patch: { reviews } }, normalizedActor);
  }

  async setHumanValidation(id, { expectedRevision, contentHash, agent, environment, skillVersion, notes }, actor) {
    const normalizedActor = normalizeActor(actor, { type: "human", name: "local-user", channel: "mcp-app" });
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
    const normalizedActor = normalizeActor(actor, { type: "human", name: "local-user", channel: "mcp-app" });
    if (normalizedActor.type !== "human") throw new Error("human-confirmation-required");
    return this.#mutate((data) => {
      const index = data.workflows.findIndex((item) => item.id === id);
      if (index < 0) throw new WorkflowNotFoundError();
      const current = data.workflows[index];
      ensureExpectedRevision(current, expectedRevision);
      assertConfirmable(current);
      const now = new Date().toISOString();
      const version = Math.max(current.confirmedVersion || 0,
        ...data.confirmations.filter((item) => item.workflowId === id).map((item) => item.version)) + 1;
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
      data.confirmations.push({
        id: crypto.randomUUID(),
        workflowId: id,
        version,
        workflowRevision: confirmed.revision,
        confirmedAt: now,
        confirmedBy: normalizedActor,
        snapshot: structuredClone(confirmed),
        assessment: assessmentSnapshot ? structuredClone(assessmentSnapshot) : null,
      });
      data.workflows[index] = confirmed;
      data.events.push(event("workflow.confirmed", confirmed, normalizedActor, { version }));
      return publicWorkflow(confirmed);
    });
  }

  async getConfirmation(id, version, { redactSensitive = false } = {}) {
    const data = await this.#readCurrent();
    const confirmation = data.confirmations.find((item) => item.workflowId === id && item.version === Number(version));
    if (!confirmation) throw new WorkflowNotFoundError();
    const result = structuredClone(confirmation);
    if (redactSensitive && result.snapshot) result.snapshot = publicWorkflow(result.snapshot, { redactSensitive: true });
    return result;
  }

}
