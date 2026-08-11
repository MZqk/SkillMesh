import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKSPACE_STORAGE_KEY,
  activeMap,
  addMap,
  createWorkspace,
  loadWorkspace,
  normalizeWorkspace,
  saveWorkspace,
  updateActiveMap,
} from "../public/workspace.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("persists multiple maps, custom roots, and content-bound reviews", () => {
  const storage = memoryStorage();
  let workspace = createWorkspace();
  updateActiveMap(workspace, {
    goal: "开发一个 Web 应用",
    overrides: { "design-experience": { "content-hash": "confirmed", ignored: "bad-value" } },
  });
  workspace.customRoots = ["~/team/skills"];
  const second = addMap(workspace, "建立一个内部工具");
  second.overrides = { "frame-direction": { "another-hash": "excluded" } };
  workspace = saveWorkspace(storage, workspace);

  const restored = loadWorkspace(storage);
  assert.equal(restored.maps.length, 2);
  assert.equal(activeMap(restored).goal, "建立一个内部工具");
  assert.equal(activeMap(restored).overrides["frame-direction"]["another-hash"], "excluded");
  assert.deepEqual(restored.customRoots, ["~/team/skills"]);
  assert.ok(storage.getItem(WORKSPACE_STORAGE_KEY));
  assert.equal(workspace.maps[1].overrides["design-experience"].ignored, undefined);
});

test("rejects malformed backups and falls back from corrupt local storage", () => {
  assert.throws(() => normalizeWorkspace({ maps: [] }), /没有技能地图/);
  const storage = {
    getItem: () => "{broken",
    setItem: () => {},
  };
  const workspace = loadWorkspace(storage);
  assert.equal(workspace.maps.length, 1);
});
