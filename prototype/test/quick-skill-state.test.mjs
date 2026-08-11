import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { QuickSkillService, isCodexCompatible } from "../lib/quick-skill-service.mjs";
import {
  applyQuickSkillOperation,
  migrateLegacyQuickSkillState,
  normalizeQuickSkillState,
} from "../lib/quick-skill-state.mjs";
import { QuickSkillStateConflictError, WorkflowStore } from "../lib/workflow-store.mjs";

function workflow(id, stages = [{ id: "discover", title: "发现" }]) {
  return { id, goal: `Workflow ${id}`, stages };
}

function skill(contentHash, supportedAgents = []) {
  return {
    contentHash,
    name: contentHash,
    description: `${contentHash} description`,
    provider: "fixture",
    enabled: true,
    supportedAgents,
  };
}

test("QuickSkillState bounds preferences and applies all three operations", () => {
  const state = normalizeQuickSkillState({
    favorites: Array.from({ length: 60 }, (_, index) => `f${index}`),
    recent: Array.from({ length: 20 }, (_, index) => ({
      contentHash: `r${index}`,
      usedAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
    })),
  });
  assert.equal(state.favorites.length, 50);
  assert.equal(state.recent.length, 12);

  const selected = applyQuickSkillOperation(state, {
    type: "select-context",
    workflowId: "one",
    stageId: "build",
  }, [workflow("one", [{ id: "build", title: "构建" }])]);
  assert.equal(selected.activeWorkflowId, "one");
  assert.equal(selected.activeStageByWorkflow.one, "build");
  const favorite = applyQuickSkillOperation(selected, { type: "set-favorite", contentHash: "new", favorite: true });
  assert.equal(favorite.favorites[0], "new");
  const recent = applyQuickSkillOperation(favorite, { type: "record-use", contentHash: "new" }, [], new Date("2026-08-09T01:02:03Z"));
  assert.deepEqual(recent.recent[0], { contentHash: "new", usedAt: "2026-08-09T01:02:03.000Z" });
});

test("legacy migration unions favorites, keeps newest recent, and never replays after completion", () => {
  const first = migrateLegacyQuickSkillState({
    activeWorkflowId: "server",
    favorites: ["server-favorite"],
    recent: [{ contentHash: "same", usedAt: "2026-01-01T00:00:00Z" }],
  }, {
    activeWorkflowId: "browser",
    selectedStageId: "browser-stage",
    preferences: {
      favorites: ["browser-favorite"],
      recent: [
        { contentHash: "same", usedAt: "2026-02-01T00:00:00Z" },
        { contentHash: "other", usedAt: "2026-01-15T00:00:00Z" },
      ],
    },
  }, [workflow("server"), workflow("browser", [{ id: "browser-stage", title: "浏览器阶段" }])]);
  assert.equal(first.state.activeWorkflowId, "server");
  assert.deepEqual(first.state.favorites, ["server-favorite", "browser-favorite"]);
  assert.equal(first.state.recent[0].usedAt, "2026-02-01T00:00:00.000Z");
  assert.equal(first.state.legacyWebMigrationCompleted, true);

  const removed = applyQuickSkillOperation(first.state, {
    type: "set-favorite",
    contentHash: "browser-favorite",
    favorite: false,
  });
  const replay = migrateLegacyQuickSkillState(removed, {
    preferences: { favorites: ["browser-favorite"] },
  }, [workflow("server")]);
  assert.equal(replay.migrated, false);
  assert.equal(replay.state.favorites.includes("browser-favorite"), false);
});

test("store rejects stale QuickSkillState revisions", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmesh-quick-state-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new WorkflowStore({ filePath: path.join(directory, "workspace.json") });
  const initial = await store.getQuickSkillState();
  const updated = await store.updateQuickSkillState({
    expectedRevision: initial.revision,
    operation: { type: "set-favorite", contentHash: "a", favorite: true },
  });
  assert.equal(updated.revision, 1);
  await assert.rejects(
    store.updateQuickSkillState({
      expectedRevision: initial.revision,
      operation: { type: "record-use", contentHash: "a" },
    }),
    (error) => error instanceof QuickSkillStateConflictError && error.currentRevision === 1,
  );
});

test("Codex compatibility keeps undeclared and Codex Skills but hides incompatible favorites", async () => {
  assert.equal(isCodexCompatible(skill("open")), true);
  assert.equal(isCodexCompatible(skill("codex", ["codex"])), true);
  assert.equal(isCodexCompatible(skill("claude", ["claude-code"])), false);

  const state = normalizeQuickSkillState({
    revision: 4,
    favorites: ["open", "codex", "claude"],
    legacyWebMigrationCompleted: true,
  });
  const store = {
    read: async () => ({ workflows: [] }),
    getQuickSkillState: async () => state,
  };
  const service = {
    inventory: async () => ({ skills: [skill("open"), skill("codex", ["codex"]), skill("claude", ["claude-code"])] }),
  };
  const snapshot = await new QuickSkillService({ store, service }).snapshot();
  assert.deepEqual(snapshot.sections.favorites.items.map((item) => item.contentHash), ["open", "codex"]);
  assert.equal(snapshot.visibility.hiddenIncompatibleFavorites, 1);
  assert.ok(snapshot.sections.totalVisible <= 14);
});

test("Codex filtering ignores a disabled Codex copy when only an enabled incompatible copy remains", async () => {
  const state = normalizeQuickSkillState({ favorites: ["shared"], legacyWebMigrationCompleted: true });
  const store = {
    read: async () => ({ workflows: [] }),
    getQuickSkillState: async () => state,
  };
  const service = {
    inventory: async () => ({
      skills: [
        skill("shared", ["codex"]),
        skill("shared", ["claude-code"]),
      ].map((item, index) => ({ ...item, id: `copy-${index}`, enabled: index !== 0 })),
    }),
  };
  const snapshot = await new QuickSkillService({ store, service }).snapshot();
  assert.equal(snapshot.sections.favorites.items.length, 0);
  assert.equal(snapshot.visibility.hiddenIncompatibleFavorites, 1);
});

test("QuickSkillService auto-selects one workflow but asks for selection when several exist", async () => {
  const state = normalizeQuickSkillState({});
  const planFor = (id) => ({
    stages: [{
      id: "discover",
      title: "发现",
      candidates: [{ contentHash: "codex", name: "codex", decision: "confirmed", score: 1 }],
    }],
    workflow: { id },
  });
  const service = {
    inventory: async () => ({ skills: [skill("codex", ["codex"])] }),
    assessWorkflow: async (id) => planFor(id),
  };
  const oneStore = {
    read: async () => ({ workflows: [workflow("one")] }),
    getQuickSkillState: async () => state,
    getPlaybook: async () => { throw new Error("playbook-not-found"); },
  };
  const one = await new QuickSkillService({ store: oneStore, service }).snapshot();
  assert.equal(one.context.workflowId, "one");
  assert.equal(one.context.selectionRequired, false);
  assert.equal(one.sections.current.items[0].contentHash, "codex");

  const manyStore = {
    ...oneStore,
    read: async () => ({ workflows: [workflow("one"), workflow("two")] }),
  };
  const many = await new QuickSkillService({ store: manyStore, service }).snapshot();
  assert.equal(many.context.workflowId, null);
  assert.equal(many.context.selectionRequired, true);
});
