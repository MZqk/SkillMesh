import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { InstallationManager } from "../lib/installation-manager.mjs";
import { defaultSkillRoots } from "../lib/roots.mjs";
import { scanSkills } from "../lib/scanner.mjs";
import { WorkflowStore } from "../lib/workflow-store.mjs";

const human = { type: "human", name: "fixture-user", channel: "web" };

function workflowInput(externalCandidates = []) {
  return {
    goal: "安装匹配的 Skill",
    scopeDescription: "验证受控安装事务。",
    nonGoals: ["不运行 Skill"],
    acceptanceCriteria: ["安装后可重新发现"],
    stages: [{
      id: "delivery",
      phase: "交付",
      title: "交付能力",
      capabilities: [{ id: "capability", label: "测试能力", required: true, terms: ["fixture"] }],
    }],
    externalCandidates,
  };
}

function assessmentForLocal({ sourceSkillPath, contentHash }) {
  return {
    summary: { matchScore: 1, coverageRatio: 1, missingRequiredCapabilities: 0 },
    stages: [{
      id: "delivery",
      capabilityCoverage: [{ id: "capability", label: "测试能力", required: true, status: "confirmed" }],
      candidates: [{
        decision: "confirmed",
        contentHash,
        name: "fixture-local",
        realPath: sourceSkillPath,
        path: sourceSkillPath,
        sourceKind: "direct",
        supportedAgents: ["*"],
        score: 1,
        capabilityScores: [{ capabilityId: "capability", strength: "strong" }],
      }],
    }],
  };
}

function fakeService(assessment, { homeDirectory, projectRoot }) {
  return {
    inventoryCache: new Map(),
    async assessWorkflow(_id, { targetAgent } = {}) {
      return {
        ...structuredClone(assessment),
        summary: {
          matchScore: 1,
          coverageRatio: 1,
          missingRequiredCapabilities: 0,
          targetAgent: targetAgent || "",
        },
      };
    },
    async inventory() {
      return scanSkills({ roots: defaultSkillRoots({ homeDirectory, projectRoot }) });
    },
  };
}

async function fixtureEnvironment(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "capability-atlas-install-"));
  const homeDirectory = path.join(root, "home");
  const dataDirectory = path.join(root, "data");
  await fs.mkdir(homeDirectory, { recursive: true });
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, homeDirectory, dataDirectory };
}

test("syncs a human-confirmed local Skill through the shared root and selected Agent", async (context) => {
  const environment = await fixtureEnvironment(context);
  const aliasedHome = path.join(environment.root, "home-alias");
  await fs.symlink(environment.homeDirectory, aliasedHome, "dir");
  const sourceDirectory = path.join(environment.homeDirectory, ".codex", "skills", "fixture-source");
  const sourceSkillPath = path.join(sourceDirectory, "SKILL.md");
  const contents = "---\nname: fixture-local\ndescription: fixture capability\n---\nSafe fixture.\n";
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.writeFile(sourceSkillPath, contents);
  const contentHash = crypto.createHash("sha256").update(contents).digest("hex");
  const store = new WorkflowStore({ filePath: path.join(environment.dataDirectory, "workspace.json") });
  const workflow = await store.createWorkflow(workflowInput(), human);
  const service = fakeService(assessmentForLocal({ sourceSkillPath, contentHash }), {
    homeDirectory: aliasedHome,
    projectRoot: path.join(environment.root, "project"),
  });
  const manager = new InstallationManager({ store, service, ...environment, homeDirectory: aliasedHome });

  const created = await manager.createPlan({
    workflowId: workflow.id,
    expectedRevision: workflow.revision,
    targetAgents: ["codex"],
  }, human);
  assert.equal(created.plan.items.length, 1);
  assert.equal(created.plan.items[0].selected, true);

  const queued = await manager.executePlan({
    workflowId: workflow.id,
    planId: created.plan.id,
    expectedRevision: created.workflow.revision,
  }, human);
  assert.equal(queued.status, "queued");
  await manager.waitForIdle();

  const finished = await store.getWorkflow(workflow.id);
  const plan = finished.installationPlans.find((item) => item.id === created.plan.id);
  assert.equal(plan.status, "completed");
  assert.equal(plan.items[0].status, "installed");
  assert.equal(plan.items[0].securityScan.status, "passed");
  assert.deepEqual(plan.execution.reloadPending, ["codex"]);
  const sharedLink = path.join(aliasedHome, ".agents", "skills", "fixture-local");
  const codexLink = path.join(aliasedHome, ".codex", "skills", "fixture-local");
  assert.equal((await fs.lstat(sharedLink)).isSymbolicLink(), true);
  assert.equal((await fs.lstat(codexLink)).isSymbolicLink(), true);
  assert.equal(await fs.realpath(codexLink), await fs.realpath(sourceDirectory));
});

test("runs external installation only after an item-specific risk acknowledgement", async (context) => {
  const environment = await fixtureEnvironment(context);
  const externalCandidate = {
    id: "candidate-1",
    stageId: "delivery",
    capabilityId: "capability",
    packageId: "example/skills@fixture-external",
    skillName: "fixture-external",
    sourceUrl: "https://skills.sh/example/skills/fixture-external",
    rationale: "accepted fixture",
    status: "accepted",
  };
  const store = new WorkflowStore({ filePath: path.join(environment.dataDirectory, "workspace.json") });
  const workflow = await store.createWorkflow(workflowInput([externalCandidate]), human);
  const assessment = {
    summary: { matchScore: 0, coverageRatio: 0, missingRequiredCapabilities: 1 },
    stages: [{
      id: "delivery",
      capabilityCoverage: [{ id: "capability", label: "测试能力", required: true, status: "missing" }],
      candidates: [],
    }],
  };
  const commands = [];
  const runner = async ({ command, args, homeDirectory }) => {
    commands.push([command, ...args]);
    const directory = path.join(homeDirectory, ".agents", "skills", "fixture-external");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "SKILL.md"), "---\nname: fixture-external\ndescription: safe external fixture\n---\nSafe.\n");
    return { code: 0, stdout: "installed", stderr: "" };
  };
  const service = fakeService(assessment, {
    homeDirectory: environment.homeDirectory,
    projectRoot: path.join(environment.root, "project"),
  });
  const manager = new InstallationManager({ store, service, runner, ...environment });
  const created = await manager.createPlan({
    workflowId: workflow.id,
    expectedRevision: workflow.revision,
    targetAgents: ["codex"],
  }, human);
  const external = created.plan.items[0];

  await assert.rejects(
    manager.executePlan({
      workflowId: workflow.id,
      planId: created.plan.id,
      expectedRevision: created.workflow.revision,
    }, human),
    /installation-risk-ack-required/,
  );
  const configured = await manager.configurePlan({
    workflowId: workflow.id,
    planId: created.plan.id,
    expectedRevision: created.workflow.revision,
    selectedItemIds: [external.id],
    itemOptions: { [external.id]: { acknowledgements: ["pre-scan-visible"] } },
  }, human);
  await manager.executePlan({
    workflowId: workflow.id,
    planId: created.plan.id,
    expectedRevision: configured.workflow.revision,
  }, human);
  await manager.waitForIdle();

  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].slice(0, 5), ["npx", "-y", "skills", "add", "example/skills@fixture-external"]);
  const finished = await store.getWorkflow(workflow.id);
  assert.equal(finished.installationPlans[0].status, "completed");
  assert.equal(finished.installationPlans[0].items[0].status, "installed");
  assert.equal(finished.externalCandidates[0].status, "installed");
});

test("isolates a newly managed local link when the post-install scan finds high risk", async (context) => {
  const environment = await fixtureEnvironment(context);
  const sourceDirectory = path.join(environment.root, "source", "risky-local");
  const sourceSkillPath = path.join(sourceDirectory, "SKILL.md");
  const contents = "---\nname: risky-local\ndescription: risky fixture\n---\nfixture\n";
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.writeFile(sourceSkillPath, contents);
  const contentHash = crypto.createHash("sha256").update(contents).digest("hex");
  const assessment = assessmentForLocal({ sourceSkillPath, contentHash });
  assessment.stages[0].candidates[0].name = "risky-local";
  const store = new WorkflowStore({ filePath: path.join(environment.dataDirectory, "workspace.json") });
  const workflow = await store.createWorkflow(workflowInput(), human);
  const manager = new InstallationManager({
    store,
    service: fakeService(assessment, {
      homeDirectory: environment.homeDirectory,
      projectRoot: path.join(environment.root, "project"),
    }),
    securityScanner: async () => ({
      status: "blocked",
      severity: "high",
      findings: [{ id: "fixture-high", severity: "high", message: "fixture", file: "SKILL.md" }],
      filesScanned: 1,
      bytesScanned: contents.length,
      truncated: false,
      scannedAt: new Date().toISOString(),
    }),
    ...environment,
  });
  const created = await manager.createPlan({
    workflowId: workflow.id,
    expectedRevision: workflow.revision,
    targetAgents: ["codex"],
  }, human);
  await manager.executePlan({
    workflowId: workflow.id,
    planId: created.plan.id,
    expectedRevision: created.workflow.revision,
  }, human);
  await manager.waitForIdle();

  const finished = await store.getWorkflow(workflow.id);
  const item = finished.installationPlans[0].items[0];
  assert.equal(item.status, "quarantined");
  assert.equal(item.securityScan.severity, "high");
  assert.equal(await fs.readFile(sourceSkillPath, "utf8"), contents);
  await assert.rejects(fs.lstat(path.join(environment.homeDirectory, ".codex", "skills", "risky-local")), /ENOENT/);
  assert.match(item.quarantinePath, /quarantine/);
});

test("cancels a running external child operation and leaves no repair lock when cleanup succeeds", async (context) => {
  const environment = await fixtureEnvironment(context);
  const externalCandidate = {
    id: "candidate-cancel",
    stageId: "delivery",
    capabilityId: "capability",
    packageId: "example/skills@cancel-fixture",
    skillName: "cancel-fixture",
    sourceUrl: "https://skills.sh/example/skills/cancel-fixture",
    rationale: "cancel fixture",
    status: "accepted",
  };
  const store = new WorkflowStore({ filePath: path.join(environment.dataDirectory, "workspace.json") });
  const workflow = await store.createWorkflow(workflowInput([externalCandidate]), human);
  const assessment = {
    summary: { matchScore: 0, coverageRatio: 0, missingRequiredCapabilities: 1 },
    stages: [{
      id: "delivery",
      capabilityCoverage: [{ id: "capability", label: "测试能力", required: true, status: "missing" }],
      candidates: [],
    }],
  };
  let started;
  const runnerStarted = new Promise((resolve) => { started = resolve; });
  const runner = ({ signal }) => new Promise((_resolve, reject) => {
    started();
    signal.addEventListener("abort", () => {
      const error = new Error("cancelled fixture");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  const manager = new InstallationManager({
    store,
    service: fakeService(assessment, {
      homeDirectory: environment.homeDirectory,
      projectRoot: path.join(environment.root, "project"),
    }),
    runner,
    ...environment,
  });
  const created = await manager.createPlan({
    workflowId: workflow.id,
    expectedRevision: workflow.revision,
    targetAgents: ["codex"],
  }, human);
  const item = created.plan.items[0];
  const configured = await manager.configurePlan({
    workflowId: workflow.id,
    planId: created.plan.id,
    expectedRevision: created.workflow.revision,
    selectedItemIds: [item.id],
    itemOptions: { [item.id]: { acknowledgements: ["pre-scan-visible"] } },
  }, human);
  const queued = await manager.executePlan({
    workflowId: workflow.id,
    planId: created.plan.id,
    expectedRevision: configured.workflow.revision,
  }, human);
  await runnerStarted;
  assert.equal((await manager.cancel({ jobId: queued.jobId }, human)).status, "cancelling");
  await manager.waitForIdle();

  const finished = await store.getWorkflow(workflow.id);
  assert.equal(finished.installationPlans[0].status, "cancelled");
  assert.equal(finished.installationPlans[0].items[0].status, "cancelled");
  assert.equal((await manager.status()).needsRepair, false);
});
