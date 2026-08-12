import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadWorkflowTemplate } from "../lib/matcher.mjs";
import { SettingsConflictError, WorkflowConflictError, WorkflowStore } from "../lib/workflow-store.mjs";

const agent = { type: "agent", name: "fixture-agent", channel: "mcp" };
const human = { type: "human", name: "fixture-user", channel: "mcp-app" };

test("persists optimistic workflow drafts and immutable human confirmations", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmesh-store-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "workspace.json");
  const store = new WorkflowStore({ filePath });
  const template = await loadWorkflowTemplate();
  const draft = await store.createWorkflow({
    goal: "开发 Skill 缺口页面",
    scopeDescription: "展示本机 Skill 证据。",
    nonGoals: ["不执行 Skill"],
    acceptanceCriteria: ["缺口清晰"],
    stages: template.stages.slice(0, 1),
  }, agent);
  const updated = await store.updateWorkflow(draft.id, { expectedRevision: 1, patch: { goal: "开发即时 Skill 方案" } }, agent);
  await assert.rejects(store.updateWorkflow(draft.id, { expectedRevision: 1, patch: { goal: "stale" } }, agent),
    (error) => error instanceof WorkflowConflictError && error.currentRevision === 2);
  const confirmed = await store.confirmWorkflow(updated.id, { expectedRevision: updated.revision }, human);
  assert.equal(confirmed.confirmedVersion, 1);
  assert.equal((await new WorkflowStore({ filePath }).getConfirmation(draft.id, 1)).snapshot.goal, "开发即时 Skill 方案");
});

test("first schema v1 read destructively removes all seven legacy execution collections and preserves supported data", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmesh-schema-v2-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "workspace.json");
  const template = await loadWorkflowTemplate();
  const source = new WorkflowStore({ filePath: path.join(directory, "source.json") });
  const workflow = await source.createWorkflow({
    goal: "保留的工作流",
    scopeDescription: "迁移后仍可读取。",
    nonGoals: ["不保留旧方案"],
    acceptanceCriteria: ["Skill 判断保留"],
    stages: template.stages.slice(0, 1),
  }, agent);
  const reviewed = await source.setHumanReview(workflow.id, {
    expectedRevision: workflow.revision,
    stageId: workflow.stages[0].id,
    contentHash: "a".repeat(64),
    decision: "confirmed",
  }, human);
  const supported = await source.read();
  const legacy = {
    ...supported,
    schemaVersion: "1",
    projectBriefs: [{ id: "brief" }],
    projectBriefConfirmations: [{ id: "brief-v1" }],
    playbooks: [{ id: "plan" }],
    playbookConfirmations: [{ id: "plan-v1" }],
    playbookProgress: [{ id: "progress" }],
    playbookVerifications: [{ id: "verification" }],
    playbookContentHashVersions: [{ id: "legacy-hash" }],
    events: [...supported.events, { type: "playbook.created" }, { type: "workflow.kept" }],
  };
  await fs.writeFile(filePath, `${JSON.stringify(legacy)}\n`);

  const migratedStore = new WorkflowStore({ filePath });
  const migrated = await migratedStore.read();
  const disk = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.equal(migrated.schemaVersion, "2");
  assert.equal(migrated.workflows[0].id, reviewed.id);
  assert.equal(migrated.workflows[0].reviews[workflow.stages[0].id]["a".repeat(64)].decision, "confirmed");
  for (const key of ["projectBriefs", "projectBriefConfirmations", "playbooks", "playbookConfirmations", "playbookProgress", "playbookVerifications", "playbookContentHashVersions"]) {
    assert.equal(key in disk, false, key);
  }
  assert.equal(disk.events.some((item) => item.type === "playbook.created"), false);
  assert.equal(disk.events.some((item) => item.type === "workspace.schema-v2-migrated"), true);
  assert.equal((await fs.readdir(directory)).some((name) => name.includes("backup")), false);
});

test("custom roots use optimistic settings revisions and preserve the schema 2 workspace", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmesh-settings-v2-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new WorkflowStore({ filePath: path.join(directory, "workspace.json") });
  const initial = await store.getSettings();
  const updated = await store.updateSettings({
    expectedRevision: initial.revision,
    customRoots: [path.join(directory, "skills")],
  }, human);
  assert.equal(updated.revision, 1);
  await assert.rejects(store.updateSettings({ expectedRevision: 0, customRoots: [] }, human),
    (error) => error instanceof SettingsConflictError && error.currentRevision === 1);
  const reopened = new WorkflowStore({ filePath: store.filePath });
  assert.deepEqual((await reopened.getSettings()).customRoots, [path.join(directory, "skills")]);
  assert.equal((await reopened.read()).schemaVersion, "2");
});

test("external Skill acceptance requires exact review evidence and a human App actor", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmesh-external-review-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new WorkflowStore({ filePath: path.join(directory, "workspace.json") });
  const template = await loadWorkflowTemplate();
  const workflow = await store.createWorkflow({
    goal: "审阅一个缺口候选",
    stages: template.stages.slice(0, 1),
  }, agent);
  const withCandidate = await store.addExternalCandidate(workflow.id, {
    expectedRevision: workflow.revision,
    candidate: {
      stageId: workflow.stages[0].id,
      capabilityId: workflow.stages[0].capabilities[0].id,
      packageId: "example/skill-pack@focused-review",
      skillName: "focused-review",
      rationale: "补齐明确缺口",
      status: "suggested",
    },
  }, agent);
  const candidate = withCandidate.externalCandidates[0];
  await assert.rejects(store.reviewExternalCandidate(workflow.id, {
    expectedRevision: withCandidate.revision,
    candidateId: candidate.id,
    decision: "accepted",
  }, human), /external-skill-review-evidence-required/);
  await assert.rejects(store.reviewExternalCandidate(workflow.id, {
    expectedRevision: withCandidate.revision,
    candidateId: candidate.id,
    decision: "accepted",
    reviewedContentHash: "a".repeat(64),
    reviewedRepository: "example/skill-pack",
    reviewedBranch: "main",
    reviewedPath: "skills/focused-review/SKILL.md",
  }, agent), /human-external-skill-review-required/);
  const accepted = await store.reviewExternalCandidate(workflow.id, {
    expectedRevision: withCandidate.revision,
    candidateId: candidate.id,
    decision: "accepted",
    reviewedContentHash: "a".repeat(64),
    reviewedRepository: "example/skill-pack",
    reviewedBranch: "main",
    reviewedPath: "skills/focused-review/SKILL.md",
    reviewedSeverity: "low",
  }, human);
  assert.equal(accepted.externalCandidates[0].status, "accepted");
  assert.equal(accepted.externalCandidates[0].reviewedContentHash, "a".repeat(64));
  assert.equal(accepted.externalCandidates[0].actor.channel, "mcp-app");
});
