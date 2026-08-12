import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CatalogService } from "../lib/catalog-service.mjs";
import { WorkflowStore } from "../lib/workflow-store.mjs";

test("keeps Skill bodies private unless one exact document is explicitly requested", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmesh-catalog-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const skillDirectory = path.join(directory, "fixture-skill");
  const skillPath = path.join(skillDirectory, "SKILL.md");
  await fs.mkdir(skillDirectory);
  await fs.writeFile(skillPath, "---\nname: fixture-private-skill\ndescription: A safe privacy fixture.\n---\nPRIVATE_BODY_SENTINEL\n");
  const store = new WorkflowStore({ filePath: path.join(directory, "workspace.json") });
  const service = new CatalogService({ store });
  service.resolvedRoots = () => [{ path: directory, provider: "fixture", scope: "custom", label: "Fixture", stability: "test", sourceKind: "direct" }];

  const search = await service.searchSkills({ query: "fixture-private", refresh: true });
  assert.equal(search.items.length, 1);
  assert.doesNotMatch(JSON.stringify(search), /PRIVATE_BODY_SENTINEL|SKILL\.md/);
  const explicit = await service.getSkillContent(search.items[0].id);
  assert.match(explicit.content, /PRIVATE_BODY_SENTINEL/);
  await fs.appendFile(skillPath, "changed\n");
  await assert.rejects(service.getSkillContent(search.items[0].id), /skill-content-changed-refresh-required/);
});

test("every Skill plan request refreshes inventory, stays stateless, and keeps an unchanged hash", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmesh-plan-service-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new WorkflowStore({ filePath: path.join(directory, "workspace.json") });
  const service = new CatalogService({ store });
  const workflow = await store.createWorkflow({
    goal: "整理交付流程",
    scopeDescription: "验证即时 Skill 方案。",
    nonGoals: ["不保存方案"],
    acceptanceCriteria: ["每次重新扫描"],
    requirement: { riskLevel: "low", targetAgents: ["claude"] },
    stages: [{
      id: "delivery",
      phase: "交付",
      title: "交付",
      acceptanceGate: "结果可复核",
      capabilities: [{ id: "delivery", label: "Delivery", required: true, terms: ["delivery"] }],
    }],
  }, { type: "agent", name: "fixture", channel: "test" });
  let scans = 0;
  service.inventory = async ({ refresh } = {}) => {
    assert.equal(refresh, true);
    scans += 1;
    return {
      generatedAt: `2026-08-1${scans}T00:00:00.000Z`,
      stats: { paths: 1, uniqueContent: 1, duplicateContentGroups: 0, nameConflictGroups: 0, providers: { fixture: 1 } },
      skills: [{
        id: "delivery-skill",
        name: "Delivery",
        description: "Delivery workflow",
        provider: "fixture",
        scope: "user",
        sourceKind: "direct",
        supportedAgents: ["claude"],
        path: "/fixture/SKILL.md",
        realPath: "/fixture/SKILL.md",
        contentHash: "d".repeat(64),
        metadataStatus: "complete",
        enabled: true,
        identity: {},
        searchText: "delivery workflow",
      }],
    };
  };
  const reviewed = await store.setHumanReview(workflow.id, {
    expectedRevision: workflow.revision,
    stageId: "delivery",
    contentHash: "d".repeat(64),
    decision: "confirmed",
  }, { type: "human", name: "fixture", channel: "mcp-app" });
  const before = await store.read();
  const first = await service.getSkillUsagePlan(reviewed.id);
  const second = await service.getSkillUsagePlan(reviewed.id);
  const unknownHost = await service.getSkillUsagePlan(reviewed.id, { currentAgent: null });
  const after = await store.read();

  assert.equal(scans, 3);
  assert.equal(first.contentHash, second.contentHash);
  assert.notEqual(first.source.inventoryGeneratedAt, second.source.inventoryGeneratedAt);
  assert.equal(unknownHost.mappingScope.currentAgent, null);
  assert.equal(unknownHost.mappingScope.targetAgents.some((target) => target.current), false);
  assert.equal(first.summaryCounts.cardCount, 1);
  assert.equal(first.mappingScope.source, "workflow");
  assert.deepEqual(first.mappingScope.targetAgents.map((target) => target.id), ["claude"]);
  assert.equal(after.revision, before.revision);
  assert.equal("skillPlans" in after, false);
});
