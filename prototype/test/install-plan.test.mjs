import assert from "node:assert/strict";
import test from "node:test";

import { buildInstallationPlan } from "../lib/install-plan.mjs";

const actor = { type: "human", name: "fixture", channel: "web" };

function workflow() {
  return {
    id: "workflow-1",
    revision: 4,
    stages: [{
      id: "stage",
      capabilities: [
        { id: "one", label: "能力一", required: true },
        { id: "two", label: "能力二", required: true },
        { id: "optional", label: "可选能力", required: false },
      ],
    }],
    externalCandidates: [{
      id: "external-two",
      stageId: "stage",
      capabilityId: "two",
      packageId: "example/skills@two",
      skillName: "external-two",
      sourceUrl: "https://skills.sh/example/skills/two",
      status: "accepted",
    }],
  };
}

function candidate({ hash, name, decision, supportedAgents = ["*"] }) {
  return {
    contentHash: hash,
    name,
    decision,
    realPath: `/fixture/${name}/SKILL.md`,
    sourceKind: "direct",
    supportedAgents,
    score: 0.9,
    capabilityScores: [{ capabilityId: "one", strength: "strong" }],
  };
}

function assessment(candidates) {
  return {
    stages: [{
      id: "stage",
      capabilityCoverage: [
        { id: "one", label: "能力一", required: true },
        { id: "two", label: "能力二", required: true },
        { id: "optional", label: "可选能力", required: false },
      ],
      candidates,
    }],
  };
}

test("admits only confirmed local matches and accepted gap candidates into the minimal install set", () => {
  const plan = buildInstallationPlan({
    workflow: workflow(),
    assessment: assessment([
      candidate({ hash: "confirmed-hash", name: "confirmed-local", decision: "confirmed" }),
      candidate({ hash: "unreviewed-hash", name: "unreviewed-local", decision: "unreviewed" }),
    ]),
    targetAgentIds: ["codex"],
    actor,
    homeDirectory: "/fixture/home",
    basedOnRevision: 5,
  });

  assert.deepEqual(plan.items.map((item) => item.name).sort(), ["confirmed-local", "external-two"]);
  assert.equal(plan.items.every((item) => item.selected), true);
  assert.equal(plan.coverage.covered, 2);
  assert.equal(plan.coverage.uncovered.length, 0);
  assert.equal(plan.items.some((item) => item.name === "unreviewed-local"), false);
});

test("keeps incompatible local Skills visible but excluded until a per-item override", () => {
  const source = workflow();
  source.externalCandidates = [];
  const plan = buildInstallationPlan({
    workflow: source,
    assessment: assessment([
      candidate({ hash: "claude-only", name: "claude-only", decision: "confirmed", supportedAgents: ["claude"] }),
    ]),
    targetAgentIds: ["codex"],
    actor,
    homeDirectory: "/fixture/home",
    basedOnRevision: 5,
  });

  assert.equal(plan.items[0].eligible, false);
  assert.equal(plan.items[0].selected, false);
  assert.deepEqual(plan.items[0].incompatibleAgents, ["codex"]);
  assert.ok(plan.items[0].riskFlags.includes("compatibility-override-required"));
});
