import {
  normalizeQuickDeckPreferences,
  recordQuickUse,
} from "../public/quick-skill-deck.js";

export const QUICK_SKILL_STATE_SCHEMA_VERSION = "1";
export const QUICK_SKILL_FAVORITE_LIMIT = 50;
export const QUICK_SKILL_RECENT_LIMIT = 12;

function cleanText(value, maximum = 500) {
  return String(value || "").trim().slice(0, maximum);
}

function validIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizedActiveStages(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([workflowId, stageId]) => [cleanText(workflowId, 200), cleanText(stageId, 200)])
    .filter(([workflowId, stageId]) => workflowId && stageId)
    .slice(0, 500));
}

export function emptyQuickSkillState() {
  return {
    schemaVersion: QUICK_SKILL_STATE_SCHEMA_VERSION,
    revision: 0,
    activeWorkflowId: null,
    activeStageByWorkflow: {},
    favorites: [],
    recent: [],
    legacyWebMigrationCompleted: false,
    updatedAt: null,
  };
}

export function normalizeQuickSkillState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const preferences = normalizeQuickDeckPreferences(source);
  return {
    ...emptyQuickSkillState(),
    revision: Math.max(0, Number.isInteger(source.revision) ? source.revision : 0),
    activeWorkflowId: cleanText(source.activeWorkflowId, 200) || null,
    activeStageByWorkflow: normalizedActiveStages(source.activeStageByWorkflow),
    favorites: preferences.favorites.slice(0, QUICK_SKILL_FAVORITE_LIMIT),
    recent: preferences.recent.slice(0, QUICK_SKILL_RECENT_LIMIT),
    legacyWebMigrationCompleted: source.legacyWebMigrationCompleted === true,
    updatedAt: validIsoDate(source.updatedAt),
  };
}

function latestRecent(...collections) {
  const byHash = new Map();
  for (const collection of collections) {
    for (const item of normalizeQuickDeckPreferences({ recent: collection }).recent) {
      const current = byHash.get(item.contentHash);
      if (!current || item.usedAt > current.usedAt) byHash.set(item.contentHash, item);
    }
  }
  return [...byHash.values()]
    .sort((left, right) => right.usedAt.localeCompare(left.usedAt))
    .slice(0, QUICK_SKILL_RECENT_LIMIT);
}

function workflowIndex(workflows) {
  return new Map((workflows || []).filter((workflow) => workflow?.id).map((workflow) => [workflow.id, workflow]));
}

function validStage(workflow, stageId) {
  return Boolean(stageId && (workflow?.stages || []).some((stage) => stage.id === stageId));
}

export function migrateLegacyQuickSkillState(current, legacy = {}, workflows = []) {
  const state = normalizeQuickSkillState(current);
  if (state.legacyWebMigrationCompleted) return { state, migrated: false };

  const preferences = normalizeQuickDeckPreferences(legacy.preferences || legacy);
  const byWorkflow = workflowIndex(workflows);
  const serverWorkflow = byWorkflow.get(state.activeWorkflowId);
  const browserWorkflow = byWorkflow.get(cleanText(legacy.activeWorkflowId, 200));
  const selectedWorkflow = serverWorkflow || browserWorkflow || (byWorkflow.size === 1 ? [...byWorkflow.values()][0] : null);
  const activeStageByWorkflow = { ...state.activeStageByWorkflow };
  if (selectedWorkflow) {
    const existingStage = activeStageByWorkflow[selectedWorkflow.id];
    const browserStage = cleanText(legacy.selectedStageId, 200);
    if (!validStage(selectedWorkflow, existingStage)) {
      const fallback = validStage(selectedWorkflow, browserStage)
        ? browserStage
        : selectedWorkflow.stages?.[0]?.id || "";
      if (fallback) activeStageByWorkflow[selectedWorkflow.id] = fallback;
      else delete activeStageByWorkflow[selectedWorkflow.id];
    }
  }

  return {
    migrated: true,
    state: normalizeQuickSkillState({
      ...state,
      activeWorkflowId: selectedWorkflow?.id || null,
      activeStageByWorkflow,
      favorites: [...new Set([...state.favorites, ...preferences.favorites])],
      recent: latestRecent(state.recent, preferences.recent),
      legacyWebMigrationCompleted: true,
    }),
  };
}

export function applyQuickSkillOperation(current, operation, workflows = [], now = new Date()) {
  const state = normalizeQuickSkillState(current);
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw new Error("quick-skill-operation-required");
  }
  const type = cleanText(operation.type, 100);
  const byWorkflow = workflowIndex(workflows);

  if (type === "select-context") {
    const requestedWorkflowId = cleanText(operation.workflowId, 200);
    if (!requestedWorkflowId) {
      return normalizeQuickSkillState({ ...state, activeWorkflowId: null });
    }
    const workflow = byWorkflow.get(requestedWorkflowId);
    if (!workflow) throw new Error("quick-skill-workflow-not-found");
    const requestedStageId = cleanText(operation.stageId, 200);
    if (requestedStageId && !validStage(workflow, requestedStageId)) {
      throw new Error("quick-skill-stage-not-found");
    }
    const existingStageId = state.activeStageByWorkflow[workflow.id];
    const stageId = requestedStageId
      || (validStage(workflow, existingStageId) ? existingStageId : workflow.stages?.[0]?.id || "");
    const activeStageByWorkflow = { ...state.activeStageByWorkflow };
    if (stageId) activeStageByWorkflow[workflow.id] = stageId;
    else delete activeStageByWorkflow[workflow.id];
    return normalizeQuickSkillState({
      ...state,
      activeWorkflowId: workflow.id,
      activeStageByWorkflow,
    });
  }

  if (type === "set-favorite") {
    const contentHash = cleanText(operation.contentHash, 256);
    if (!contentHash || typeof operation.favorite !== "boolean") {
      throw new Error("quick-skill-favorite-invalid");
    }
    const favorites = operation.favorite
      ? [contentHash, ...state.favorites.filter((item) => item !== contentHash)]
      : state.favorites.filter((item) => item !== contentHash);
    return normalizeQuickSkillState({ ...state, favorites });
  }

  if (type === "record-use") {
    const contentHash = cleanText(operation.contentHash, 256);
    if (!contentHash) throw new Error("quick-skill-content-hash-required");
    return normalizeQuickSkillState({
      ...state,
      ...recordQuickUse(state, contentHash, now),
    });
  }

  throw new Error("quick-skill-operation-unsupported");
}
