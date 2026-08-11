import assert from "node:assert/strict";
import test from "node:test";

import { buildPlan, loadWorkflowTemplateForRequirement } from "../lib/matcher.mjs";

function skill(overrides = {}) {
  return {
    id: "skill-1",
    name: "Frontend QA",
    description: "Frontend design, responsive accessibility, Playwright browser test and QA.",
    provider: "fixture",
    scope: "user",
    sourceKind: "direct",
    path: "/fixture/frontend-qa/SKILL.md",
    realPath: "/fixture/frontend-qa/SKILL.md",
    contentHash: "abc",
    metadataStatus: "complete",
    identity: {},
    searchText: "Frontend design responsive accessibility Playwright browser test QA.",
    ...overrides,
  };
}

function inventory(skills) {
  return {
    stats: { paths: skills.length, uniqueContent: skills.length },
    skills,
  };
}

test("maps evidence to a human-curated lifecycle and exposes assumptions", async () => {
  const plan = await buildPlan({
    goal: "做一个帮助自由职业者整理项目的 Web 应用",
    inventory: inventory([skill()]),
  });
  const design = plan.stages.find((stage) => stage.id === "design-experience");
  const quality = plan.stages.find((stage) => stage.id === "assure-quality");
  const launch = plan.stages.find((stage) => stage.id === "launch-product");

  assert.equal(plan.template.referenceType, "human-curated");
  assert.equal(plan.stages.length, 9);
  assert.equal(design.status, "partial");
  assert.equal(quality.status, "partial");
  assert.equal(launch.status, "missing");
  assert.deepEqual(design.capabilityCoverage.map((item) => item.status), ["missing", "evidenced"]);
  assert.ok(launch.capabilityCoverage.every((item) => item.status === "missing"));
  assert.equal(design.candidates[0].id, "abc");
  assert.ok(design.candidates[0].evidence.some((item) => item.strength === "strong"));
  assert.equal(design.coverage.confirmed, 0);
  assert.equal(design.coverage.confirmedRatio, 0);
  assert.ok(plan.summary.evidencedCoverageRatio > plan.summary.confirmedCoverageRatio);
  assert.equal(plan.summary.confirmedCoverageRatio, 0);
  assert.ok(plan.summary.unconfirmedRequiredCapabilities > 0);
  assert.match(plan.assumptions.join(" "), /不把通用模型/);
});

test("human confirmation and exclusion are reversible plan inputs", async () => {
  const fixture = skill({
    id: "generalist",
    name: "General helper",
    description: "Miscellaneous assistant.",
    searchText: "Miscellaneous assistant.",
  });
  const confirmed = await buildPlan({
    goal: "开发一个 Web 应用",
    inventory: inventory([fixture]),
    overrides: { "frame-direction": { abc: "confirmed" } },
  });
  const excluded = await buildPlan({
    goal: "开发一个 Web 应用",
    inventory: inventory([skill()]),
    overrides: { "design-experience": { abc: "excluded" } },
  });

  assert.equal(confirmed.stages[0].status, "partial");
  assert.equal(confirmed.stages[0].candidates[0].decision, "confirmed");
  assert.equal(excluded.stages.find((stage) => stage.id === "design-experience").status, "missing");
  assert.equal(excluded.stages.find((stage) => stage.id === "design-experience").excludedCount, 1);
});

test("complete means all strong capabilities were explicitly confirmed", async () => {
  const designSkill = skill({
    id: "design-expert",
    logicalName: "design-expert",
    name: "Design expert",
    description: "Product design, user flow, UI design and accessibility.",
    searchText: "Product design, user flow, UI design and accessibility.",
  });
  const plan = await buildPlan({
    goal: "开发一个 Web 应用",
    inventory: inventory([designSkill]),
    overrides: { "design-experience": { abc: "confirmed" } },
  });
  const stage = plan.stages.find((item) => item.id === "design-experience");

  assert.equal(stage.status, "complete");
  assert.deepEqual(stage.review, { confirmedCapabilities: 2, totalCapabilities: 2 });
  assert.equal(stage.coverage.confirmedRatio, 1);
  assert.ok(stage.capabilityCoverage.every((item) => item.status === "confirmed"));
});

test("reports coverage and runtime readiness as independent evidence axes", async () => {
  const plan = await buildPlan({
    goal: "开发一个 Web 应用",
    inventory: inventory([skill()]),
    validations: {
      abc: {
        status: "human-verified",
        agent: "fixture-agent",
        environment: "test",
        updatedAt: new Date().toISOString(),
      },
    },
  });
  const candidate = plan.stages.find((stage) => stage.id === "design-experience").candidates[0];

  assert.equal(candidate.decision, "unreviewed");
  assert.equal(candidate.readiness, "human-verified");
  assert.equal(candidate.validation.agent, "fixture-agent");
});

test("uses a supplied feature workflow without imposing the Web lifecycle assumption", async () => {
  const plan = await buildPlan({
    goal: "整理播客制作流程",
    inventory: inventory([]),
    workflow: {
      id: "podcast",
      name: "播客制作",
      version: "1",
      referenceType: "agent-draft",
      description: "Feature-specific workflow",
      stages: [{
        id: "record",
        order: 1,
        phase: "制作",
        title: "录制",
        summary: "录制音频",
        description: "录制可编辑的音频",
        dependencies: [],
        deliverables: ["音频"],
        acceptanceGate: "音频可播放",
        questions: [],
        capabilities: [{ id: "audio", label: "音频录制", terms: ["audio"] }],
      }],
    },
  });

  assert.equal(plan.stages.length, 1);
  assert.match(plan.assumptions.join(" "), /不额外假定固定行业流程/);
  assert.doesNotMatch(plan.assumptions.join(" "), /需要上线并持续迭代的 Web 产品/);
});

test("selects an Android workflow and does not treat Web-only evidence as Android coverage", async () => {
  const workflow = await loadWorkflowTemplateForRequirement({
    goal: "开发一个 Android 应用",
    requirement: { targetPlatforms: ["Android"], preferredStack: ["Kotlin", "Jetpack Compose"] },
  });
  assert.equal(workflow.id, "android-product-lifecycle");

  const androidSkill = skill({
    id: "android",
    contentHash: "android-hash",
    logicalName: "android-compose",
    name: "Android Jetpack Compose",
    description: "Kotlin Android development with Jetpack Compose, coroutines, Flow and Gradle.",
    searchText: "Kotlin Android development Jetpack Compose coroutines Flow Gradle.",
    supportedAgents: ["codex"],
  });
  const webOnly = skill({
    id: "web",
    contentHash: "web-hash",
    logicalName: "react-web",
    name: "React Web Builder",
    description: "Build React websites with HTML and CSS.",
    searchText: "React Web frontend HTML CSS.",
    supportedAgents: ["codex"],
  });
  const plan = await buildPlan({
    goal: "开发一个 Android 应用",
    workflow: {
      ...workflow,
      requirement: { targetPlatforms: ["Android"], preferredStack: ["Kotlin", "Jetpack Compose"], targetAgents: ["codex"] },
      nonGoals: ["不开发 Web 页面"],
    },
    inventory: inventory([androidSkill, webOnly]),
  });
  const implementation = plan.stages.find((stage) => stage.id === "implement-compose-slice");

  assert.deepEqual(implementation.capabilityCoverage.map((item) => item.status), ["evidenced", "evidenced"]);
  assert.equal(implementation.candidates[0].name, "Android Jetpack Compose");
  assert.ok(implementation.candidates.every((candidate) => candidate.name !== "React Web Builder"));
  assert.ok(implementation.candidates[0].score < 1);
  assert.ok(implementation.matchPercent < 100);
  assert.deepEqual(plan.scoring.dimensions, ["fitScore", "coverageScore", "readinessScore", "qualityScore", "confidence"]);
});

test("excludes disabled and agent-incompatible Skills before matching", async () => {
  const workflow = {
    id: "single",
    name: "Single",
    version: "1",
    referenceType: "agent-draft",
    description: "Fixture",
    requirement: { targetAgents: ["codex"] },
    stages: [{
      id: "build",
      order: 1,
      phase: "build",
      title: "Build",
      capabilities: [{ id: "compose", label: "Jetpack Compose", terms: ["jetpack compose"] }],
    }],
  };
  const disabled = skill({
    contentHash: "disabled",
    name: "Jetpack Compose disabled",
    description: "Jetpack Compose expert.",
    searchText: "Jetpack Compose expert.",
    enabled: false,
    supportedAgents: ["codex"],
  });
  const incompatible = skill({
    contentHash: "incompatible",
    name: "Jetpack Compose Claude",
    description: "Jetpack Compose expert.",
    searchText: "Jetpack Compose expert.",
    supportedAgents: ["claude"],
  });
  const plan = await buildPlan({ goal: "Android", workflow, inventory: inventory([disabled, incompatible]) });

  assert.equal(plan.stages[0].status, "missing");
  assert.equal(plan.stages[0].candidates.length, 0);
  assert.equal(plan.summary.disabledOrIncompatible, 2);
});

test("treats the wildcard Agent declaration as compatible with a selected target", async () => {
  const workflow = {
    id: "wildcard-agent",
    name: "Wildcard Agent",
    version: "1",
    referenceType: "agent-draft",
    description: "Fixture",
    requirement: { targetAgents: ["codex"] },
    stages: [{
      id: "build",
      order: 1,
      phase: "build",
      title: "Build",
      capabilities: [{ id: "fixture", label: "Fixture capability", terms: ["fixture capability"] }],
    }],
  };
  const universal = skill({
    contentHash: "wildcard-compatible",
    name: "Universal fixture",
    description: "Fixture capability for every Agent.",
    searchText: "Fixture capability for every Agent.",
    supportedAgents: ["*"],
  });

  const plan = await buildPlan({ goal: "Fixture", workflow, inventory: inventory([universal]) });

  assert.equal(plan.stages[0].candidates[0].name, "Universal fixture");
  assert.equal(plan.summary.disabledOrIncompatible, 0);
});

test("keeps a Skill eligible for every Agent where identical content is installed", async () => {
  const workflow = {
    id: "multi-agent-copy",
    name: "Multi-agent copy",
    version: "1",
    referenceType: "agent-draft",
    description: "Fixture",
    requirement: { targetAgents: ["codex"] },
    stages: [{
      id: "build",
      order: 1,
      phase: "build",
      title: "Build",
      capabilities: [{ id: "fixture", label: "Fixture capability", terms: ["fixture capability"] }],
    }],
  };
  const shared = {
    contentHash: "same-agent-content",
    name: "Shared fixture",
    description: "Fixture capability for a selected Agent.",
    searchText: "Fixture capability for a selected Agent.",
  };
  const claudeCopy = skill({
    ...shared,
    id: "claude-copy",
    provider: "claude",
    path: "/fixture/.claude/skills/shared/SKILL.md",
    supportedAgents: ["claude"],
  });
  const codexCopy = skill({
    ...shared,
    id: "codex-copy",
    provider: "codex",
    path: "/fixture/.codex/skills/shared/SKILL.md",
    supportedAgents: ["codex"],
  });

  const plan = await buildPlan({ goal: "Fixture", workflow, inventory: inventory([claudeCopy, codexCopy]) });

  assert.equal(plan.stages[0].candidates[0].name, "Shared fixture");
  assert.deepEqual(plan.stages[0].candidates[0].providers, ["claude", "codex"]);
  assert.deepEqual(plan.stages[0].candidates[0].supportedAgents, ["claude", "codex"]);
  assert.equal(plan.summary.disabledOrIncompatible, 0);
});
