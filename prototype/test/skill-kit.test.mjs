import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadWorkflowTemplate } from "../lib/matcher.mjs";
import {
  SKILL_KIT_SCHEMA,
  buildSkillKit,
  normalizeSkillKit,
  reconcileSkillKit,
} from "../lib/skill-kit.mjs";
import { WorkflowStore } from "../lib/workflow-store.mjs";
import { createServer } from "../server.mjs";

const human = { type: "human", name: "fixture", channel: "web" };

function kitFixture() {
  const workflow = {
    id: "workflow-kit",
    goal: "交付可复现项目",
    scope: "project",
    projectId: "project-one",
    revision: 7,
    externalCandidates: [{
      id: "candidate-chain",
      packageId: "fixture/skills@external-one",
      sourceUrl: "https://github.com/fixture/skills",
      catalogItemId: "catalog-item",
      catalogGroupId: "catalog-group",
      catalogGroup: "核心交付链",
      chain: true,
      chainPosition: 2,
      chainLength: 4,
    }],
  };
  const plan = {
    id: "plan-one",
    basedOnRevision: 7,
    targetAgents: ["codex", "claude"],
    coverage: { required: 3, covered: 2, uncovered: [{ label: "部署验证" }] },
    items: [{
      id: "local-one",
      type: "local-sync",
      name: "local-one",
      contentHash: "local-hash-one",
      sourcePath: "/private/sensitive/local-one/SKILL.md",
      canonicalPath: "/private/sensitive/shared/local-one",
      command: ["do-not-export"],
      acknowledgements: ["private-decision"],
      capabilityRefs: [{ stageId: "build", capabilityId: "implementation", label: "实现", required: true, strength: "strong" }],
      selected: true,
    }, {
      id: "external-one",
      externalCandidateId: "candidate-chain",
      type: "external-install",
      name: "external-one",
      packageId: "fixture/skills@external-one",
      sourceUrl: "https://github.com/fixture/skills",
      version: "reviewed-sha256:bbbbbbbbbbbbbbbb",
      reviewedContentHash: "b".repeat(64),
      targetPaths: { codex: "/private/sensitive/codex/external-one" },
      capabilityRefs: [{ stageId: "test", capabilityId: "review", label: "评审", required: true, strength: "external" }],
      selected: true,
    }, {
      id: "not-selected",
      type: "local-sync",
      name: "not-selected",
      contentHash: "not-selected-hash",
      selected: false,
    }],
  };
  return { workflow, plan };
}

test("builds a stable, path-free project Skill Kit with chain provenance", () => {
  const fixture = kitFixture();
  const first = buildSkillKit(fixture);
  const second = buildSkillKit(fixture);
  const serialized = JSON.stringify(first);

  assert.deepEqual(first, second);
  assert.equal(first.schema, SKILL_KIT_SCHEMA);
  assert.match(first.intentHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(first.skills.map((skill) => skill.name), ["local-one", "external-one"]);
  assert.equal(first.skills[1].catalog.chainPosition, 2);
  assert.equal(first.skills[1].catalog.chainLength, 4);
  assert.equal(first.skills[1].contentHash, "b".repeat(64));
  assert.doesNotMatch(serialized, /private\/sensitive|do-not-export|private-decision/u);
  assert.equal(first.boundaries.comparisonOnlyOnImport, true);
  assert.equal(first.boundaries.undeclaredLocalSkills, "leave-untouched");
});

test("rejects tampered, duplicate, and unsafe external Skill Kit entries", () => {
  const kit = buildSkillKit(kitFixture());
  const unsigned = structuredClone(kit);
  unsigned.intentHash = "";
  assert.throws(() => normalizeSkillKit(unsigned), /skill-kit-hash-required/u);

  const tampered = structuredClone(kit);
  tampered.skills[0].name = "changed-after-export";
  assert.throws(() => normalizeSkillKit(tampered), /skill-kit-hash-mismatch/u);

  const duplicate = structuredClone(kit);
  duplicate.intentHash = "";
  duplicate.skills.push(structuredClone(duplicate.skills[0]));
  assert.throws(() => normalizeSkillKit(duplicate), /skill-kit-duplicate-skill/u);

  const unsafe = structuredClone(kit);
  unsafe.intentHash = "";
  unsafe.skills[1].packageId = "https://example.com/install.sh";
  assert.throws(() => normalizeSkillKit(unsafe), /skill-kit-external-package-invalid/u);
});

test("previews exact, drifted, disabled, recorded, and missing Kit members without effects", () => {
  const kit = normalizeSkillKit({
    schema: SKILL_KIT_SCHEMA,
    kind: "skill-kit",
    workflow: { referenceId: "source-workflow", goal: "可移植项目", revision: 3 },
    targetAgents: ["codex"],
    coverage: { required: 6, covered: 6, uncovered: [] },
    skills: [
      { name: "alpha", type: "local-sync", contentHash: "hash-alpha" },
      { name: "beta", type: "local-sync", contentHash: "hash-beta" },
      { name: "gamma", type: "local-sync", contentHash: "hash-gamma" },
      { name: "delta", type: "external-install", packageId: "fixture/skills@delta" },
      { name: "epsilon", type: "external-install", packageId: "fixture/skills@epsilon" },
      { name: "zeta", type: "external-install", packageId: "fixture/skills@zeta" },
    ],
  }, { verifyHash: false });
  const preview = reconcileSkillKit({
    kit,
    inventory: { skills: [
      { name: "alpha", contentHash: "hash-alpha", enabled: true, provider: "agent-skills" },
      { name: "beta", contentHash: "other-beta", enabled: true, provider: "codex" },
      { name: "gamma", contentHash: "hash-gamma", enabled: false, provider: "agent-skills" },
      { name: "delta", contentHash: "local-delta", enabled: true, provider: "claude" },
      { name: "undeclared", contentHash: "extra", enabled: true, provider: "codex" },
    ] },
    workflow: {
      id: "target-workflow",
      externalCandidates: [{ packageId: "fixture/skills@epsilon", status: "accepted" }],
    },
  });

  assert.deepEqual(preview.items.map((item) => item.action), [
    "up-to-date",
    "local-changes",
    "disabled",
    "present-unverified",
    "recorded",
    "missing",
  ]);
  assert.deepEqual(preview.summary, {
    total: 6,
    ready: 1,
    attention: 3,
    recorded: 1,
    missing: 1,
    undeclaredLocal: 1,
  });
  assert.equal(preview.workflowMatch, "portable-intent");
  assert.deepEqual(preview.effects, {
    writePerformed: false,
    candidatesCreated: 0,
    installationPlansCreated: 0,
    localSkillsRemoved: 0,
  });
});

test("Skill Kit API exports and previews without mutating the workflow", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capability-atlas-kit-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new WorkflowStore({ filePath: path.join(directory, "workspace.json") });
  const template = await loadWorkflowTemplate();
  const created = await store.createWorkflow({ ...template, goal: "验证项目 Kit" }, human);
  const planId = "kit-plan";
  const workflow = await store.updateWorkflow(created.id, {
    expectedRevision: created.revision,
    patch: {
      installationPlans: [{
        id: planId,
        status: "draft",
        workflowId: created.id,
        basedOnRevision: created.revision + 1,
        targetAgents: ["codex"],
        sharedRoot: "/private/redacted/shared",
        coverage: { required: 1, covered: 1, uncovered: [] },
        items: [{
          id: "kit-local-item",
          type: "local-sync",
          name: "kit-local",
          installName: "kit-local",
          sourcePath: "/private/redacted/source/SKILL.md",
          contentHash: "kit-local-hash",
          targetAgents: ["codex"],
          canonicalPath: "/private/redacted/shared/kit-local",
          targetPaths: { codex: "/private/redacted/codex/kit-local" },
          capabilityRefs: [{ stageId: "discover", capabilityId: "research", label: "研究", required: true }],
          selected: true,
          eligible: true,
          status: "planned",
        }],
      }],
    },
  }, human);
  const service = {
    store,
    publicInventory: async () => ({
      skills: [{ name: "kit-local", contentHash: "kit-local-hash", enabled: true, provider: "fixture" }],
    }),
  };
  const server = createServer({ store, service, dataDirectory: directory, homeDirectory: directory });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const exportedResponse = await fetch(`${baseUrl}/api/workflows/${workflow.id}/skill-kit?planId=${planId}`);
  const exportedText = await exportedResponse.text();
  const exported = JSON.parse(exportedText);
  assert.equal(exportedResponse.status, 200);
  assert.match(exportedResponse.headers.get("content-disposition"), /capability-atlas\.skill-kit\.json/u);
  assert.doesNotMatch(exportedText, /private\/redacted/u);

  const previewResponse = await fetch(`${baseUrl}/api/workflows/${workflow.id}/skill-kit/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kit: exported }),
  });
  const preview = await previewResponse.json();
  assert.equal(previewResponse.status, 200);
  assert.equal(preview.summary.ready, 1);
  assert.equal(preview.effects.writePerformed, false);
  assert.equal((await store.getWorkflow(workflow.id)).revision, workflow.revision);

  exported.skills[0].name = "tampered";
  const rejectedResponse = await fetch(`${baseUrl}/api/workflows/${workflow.id}/skill-kit/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kit: exported }),
  });
  assert.equal(rejectedResponse.status, 400);
  assert.equal((await rejectedResponse.json()).message, "skill-kit-hash-mismatch");
  assert.equal((await store.getWorkflow(workflow.id)).revision, workflow.revision);
});
