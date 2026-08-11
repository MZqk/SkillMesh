export const WORKSPACE_STORAGE_KEY = "capability-atlas.workspace.v1";
export const DEFAULT_GOAL = "开发一个帮助我理解本机 Agent Skills 的 Web 应用";

function now() {
  return new Date().toISOString();
}

function identifier() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `map-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createMap(goal = DEFAULT_GOAL) {
  const timestamp = now();
  return {
    id: identifier(),
    goal: String(goal || DEFAULT_GOAL).slice(0, 2_000),
    overrides: {},
    selectedStageId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createWorkspace() {
  const map = createMap();
  return {
    schemaVersion: "1",
    activeMapId: map.id,
    activeWorkflowId: null,
    customRoots: [],
    maps: [map],
  };
}

function cleanOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).slice(0, 100).flatMap(([stageId, decisions]) => {
      if (!decisions || typeof decisions !== "object" || Array.isArray(decisions)) return [];
      const clean = Object.fromEntries(
        Object.entries(decisions)
          .filter(([, decision]) => decision === "confirmed" || decision === "excluded")
          .slice(0, 2_000),
      );
      return Object.keys(clean).length ? [[String(stageId).slice(0, 200), clean]] : [];
    }),
  );
}

export function normalizeWorkspace(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("备份格式不是工作区对象");
  const maps = Array.isArray(value.maps)
    ? value.maps.slice(0, 30).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const map = createMap(item.goal);
        map.id = String(item.id || map.id).slice(0, 200);
        map.overrides = cleanOverrides(item.overrides);
        map.selectedStageId = item.selectedStageId ? String(item.selectedStageId).slice(0, 200) : null;
        map.createdAt = String(item.createdAt || map.createdAt);
        map.updatedAt = String(item.updatedAt || map.updatedAt);
        return [map];
      })
    : [];
  if (!maps.length) throw new Error("备份中没有技能地图");

  const customRoots = Array.isArray(value.customRoots)
    ? [...new Set(value.customRoots.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 20)
    : [];
  const activeMapId = maps.some((map) => map.id === value.activeMapId)
    ? value.activeMapId
    : maps[0].id;
  const activeWorkflowId = value.activeWorkflowId ? String(value.activeWorkflowId).slice(0, 200) : null;
  return { schemaVersion: "1", activeMapId, activeWorkflowId, customRoots, maps };
}

export function loadWorkspace(storage) {
  try {
    const raw = storage.getItem(WORKSPACE_STORAGE_KEY);
    return raw ? normalizeWorkspace(JSON.parse(raw)) : createWorkspace();
  } catch {
    return createWorkspace();
  }
}

export function saveWorkspace(storage, workspace) {
  const normalized = normalizeWorkspace(workspace);
  storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function activeMap(workspace) {
  return workspace.maps.find((map) => map.id === workspace.activeMapId) || workspace.maps[0];
}

export function updateActiveMap(workspace, patch) {
  const current = activeMap(workspace);
  Object.assign(current, patch, { updatedAt: now() });
  return current;
}

export function addMap(workspace, goal = DEFAULT_GOAL) {
  const map = createMap(goal);
  workspace.maps.unshift(map);
  workspace.maps = workspace.maps.slice(0, 30);
  workspace.activeMapId = map.id;
  return map;
}
