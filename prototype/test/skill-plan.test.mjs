import assert from "node:assert/strict";
import test from "node:test";

import { loadWorkflowTemplate } from "../lib/matcher.mjs";
import { compileSkillUsagePlan, resolveSkillPlanDepth } from "../lib/skill-plan.mjs";
import { renderSkillPlanMarkdown } from "../lib/skill-plan-renderer.mjs";

function workflowFrom(template, { riskLevel = "medium", stageCount = template.stages.length } = {}) {
  return {
    id: "workflow-fixture",
    goal: "交付一个可信 Web 产品",
    revision: 4,
    reference: { id: template.id, version: template.version },
    requirement: { riskLevel },
    stages: template.stages.slice(0, stageCount),
  };
}

function assessmentFor(workflow, { confirmed = true, partial = false, alternatives = 3 } = {}) {
  return {
    generatedAt: "2026-08-11T00:00:00.000Z",
    scoring: { version: "fixture-v1" },
    stages: workflow.stages.map((stage, stageIndex) => {
      const capabilities = stage.capabilities.filter((item) => item.required !== false);
      const covered = partial ? capabilities.slice(0, 1) : capabilities;
      const score = (candidateIndex, decision) => ({
        id: `skill-${stageIndex}-${candidateIndex}`,
        contentHash: `${stageIndex}-${candidateIndex}`.padEnd(64, "a"),
        name: `${decision === "confirmed" ? "Primary" : "Alternative"} ${stageIndex}-${candidateIndex}`,
        decision,
        readiness: "unverified",
        score: 0.91 - candidateIndex * 0.02,
        confidence: 0.9,
        warnings: [],
        capabilityScores: (decision === "confirmed" ? covered : capabilities).map((capability) => ({
          capabilityId: capability.id,
          strength: "strong",
        })),
      });
      return {
        id: stage.id,
        candidates: [
          ...(confirmed ? [score(0, "confirmed")] : []),
          ...Array.from({ length: alternatives }, (_, index) => score(index + 1, "unreviewed")),
        ],
        capabilityCoverage: capabilities.map((capability) => ({
          id: capability.id,
          label: capability.label,
          status: covered.some((item) => item.id === capability.id) ? "confirmed" : "evidenced",
          externalCandidates: [],
        })),
      };
    }),
  };
}

test("automatic depth keeps quick, standard, and full rules deterministic", async () => {
  const template = await loadWorkflowTemplate();
  assert.equal(resolveSkillPlanDepth(workflowFrom(template, { riskLevel: "low" })), "quick");
  assert.equal(resolveSkillPlanDepth(workflowFrom(template, { riskLevel: "medium", stageCount: 3 })), "quick");
  assert.equal(resolveSkillPlanDepth(workflowFrom(template, { riskLevel: "medium", stageCount: 4 })), "standard");
  assert.equal(resolveSkillPlanDepth(workflowFrom(template, { riskLevel: "high" })), "full");
  assert.equal(resolveSkillPlanDepth(workflowFrom(template, { riskLevel: "critical" })), "full");
});

test("full plans preserve ordered steps, require a confirmed strong primary, and cap alternatives at two", async () => {
  const template = await loadWorkflowTemplate();
  const workflow = workflowFrom(template, { riskLevel: "high" });
  const plan = await compileSkillUsagePlan({ workflow, assessment: assessmentFor(workflow) });
  const cards = plan.stages.flatMap((stage) => stage.cards);

  assert.equal(plan.schemaVersion, "1");
  assert.equal(plan.planningDepth, "full");
  assert.equal(cards.length, 18);
  assert.deepEqual(cards.map((card) => card.order), Array.from({ length: 18 }, (_, index) => index + 1));
  assert.ok(cards.every((card) => card.primary.reviewStatus === "confirmed"));
  assert.ok(cards.every((card) => card.alternatives.length === 2));
  assert.ok(cards.every((card) => card.alternatives.every((item) => item.reviewStatus === "suggested")));
  assert.equal(plan.gaps.length, 0);
});

test("partial primary coverage keeps the card and lifts uncovered capabilities into the top gaps", async () => {
  const template = await loadWorkflowTemplate();
  const workflow = workflowFrom(template, { riskLevel: "high", stageCount: 1 });
  const plan = await compileSkillUsagePlan({ workflow, assessment: assessmentFor(workflow, { partial: true }) });

  assert.equal(plan.stages[0].cards.length, 1);
  assert.ok(plan.stages[0].cards.some((card) => card.coverageGaps.length > 0));
  assert.ok(plan.gaps.length > 0);
  assert.ok(plan.gaps.every((gap) => gap.stepId && gap.sourceStageIds.includes(workflow.stages[0].id)));
});

test("confirmed supporting Skills complete target coverage without becoming pending alternatives", async () => {
  const template = await loadWorkflowTemplate();
  const workflow = workflowFrom(template, { riskLevel: "high", stageCount: 1 });
  const assessment = assessmentFor(workflow, { partial: true, alternatives: 1 });
  const missingIds = workflow.stages[0].capabilities.filter((item) => item.required !== false).slice(1).map((item) => item.id);
  assessment.stages[0].candidates[1].decision = "confirmed";
  assessment.stages[0].candidates[1].capabilityScores = missingIds.map((capabilityId) => ({ capabilityId, strength: "strong" }));
  const plan = await compileSkillUsagePlan({ workflow, assessment });
  const card = plan.stages[0].cards[0];

  assert.equal(card.supportingSkills.length, 1);
  assert.equal(card.alternatives.length, 0);
  assert.equal(card.coverageGaps.length, 0);
  assert.equal(plan.gaps.length, 0);
});

test("steps without a trusted primary produce no cards and only explicit capability gaps", async () => {
  const template = await loadWorkflowTemplate();
  const workflow = workflowFrom(template, { riskLevel: "high", stageCount: 1 });
  const plan = await compileSkillUsagePlan({ workflow, assessment: assessmentFor(workflow, { confirmed: false }) });

  assert.equal(plan.summaryCounts.cardCount, 0);
  assert.equal(plan.summaryCounts.trustedSkillCount, 0);
  assert.ok(plan.summaryCounts.gapCount > 0);
  assert.ok(plan.gaps.every((gap) => gap.candidates.length > 0));
});

test("maps each target Agent independently into ready, transferable, pending, and ecosystem states", async () => {
  const workflow = {
    id: "multi-agent-workflow",
    goal: "跨 Agent 交付",
    revision: 7,
    reference: { id: "multi-agent", version: "1" },
    requirement: { riskLevel: "high", targetAgents: ["codex", "claude"] },
    stages: [{
      id: "delivery",
      phase: "交付",
      title: "完成交付",
      capabilities: [
        { id: "ready", label: "目标端能力", required: true },
        { id: "transfer", label: "其他 Agent 能力", required: true },
        { id: "pending", label: "待确认能力", required: true },
        { id: "ecosystem", label: "生态缺口", required: true },
      ],
    }],
  };
  const candidate = ({ id, name, agent, capabilityId, decision = "confirmed" }) => ({
    id,
    contentHash: id.padEnd(64, id[0]),
    name,
    provider: agent,
    providers: [agent],
    supportedAgents: [agent],
    decision,
    readiness: "unverified",
    score: 0.9,
    confidence: 0.9,
    warnings: [],
    capabilityScores: [{ capabilityId, strength: "strong" }],
  });
  const codexReady = candidate({ id: "codex-ready", name: "Codex Ready", agent: "codex", capabilityId: "ready" });
  const claudeReady = candidate({ id: "claude-ready", name: "Claude Ready", agent: "claude", capabilityId: "transfer" });
  const pending = candidate({ id: "codex-pending", name: "Pending Skill", agent: "codex", capabilityId: "pending", decision: "unreviewed" });
  const coverage = workflow.stages[0].capabilities.map((capability) => ({
    id: capability.id,
    label: capability.label,
    status: capability.id === "ecosystem" ? "missing" : "evidenced",
    externalCandidates: capability.id === "ecosystem"
      ? [{ skillName: "Ecosystem Candidate", status: "suggested" }]
      : [],
  }));
  const assessment = (candidates) => ({
    generatedAt: "2026-08-12T00:00:00.000Z",
    scoring: { version: "fixture-v1" },
    stages: [{ id: "delivery", candidates, capabilityCoverage: coverage }],
  });
  const codexAssessment = assessment([codexReady, pending]);
  const claudeAssessment = assessment([claudeReady]);
  const globalAssessment = assessment([codexReady, claudeReady, pending]);
  const mappingScope = {
    source: "workflow",
    currentAgent: "codex",
    targetAgents: [
      { id: "codex", label: "Codex", detected: true, current: true },
      { id: "claude", label: "Claude Code", detected: true, current: false },
    ],
  };
  const plan = await compileSkillUsagePlan({
    workflow,
    assessment: codexAssessment,
    globalAssessment,
    mappingScope,
    targetAssessments: [
      { targetAgent: mappingScope.targetAgents[0], assessment: codexAssessment },
      { targetAgent: mappingScope.targetAgents[1], assessment: claudeAssessment },
    ],
  });

  assert.equal(plan.targetPlans.length, 2);
  assert.deepEqual(plan.targetPlans[0].capabilityAvailability.map((item) => item.status), [
    "ready",
    "other-agent",
    "pending",
    "ecosystem",
  ]);
  assert.deepEqual(plan.targetPlans[1].capabilityAvailability.map((item) => item.status), [
    "other-agent",
    "ready",
    "pending",
    "ecosystem",
  ]);
  assert.equal(plan.mappingScope.allTargetsReady, false);
  assert.equal(plan.summaryCounts.readyCapabilityCount, 2);
  assert.equal(plan.summaryCounts.otherAgentCount, 2);
  assert.equal(plan.summaryCounts.pendingCount, 2);
  assert.equal(plan.summaryCounts.ecosystemGapCount, 2);
  assert.ok(plan.targetPlans.every((target) => target.summaryCounts.fullyCovered === false));
});

test("generated time and inventory scan time do not affect the stable content hash", async () => {
  const template = await loadWorkflowTemplate();
  const workflow = workflowFrom(template, { riskLevel: "medium", stageCount: 4 });
  const assessment = assessmentFor(workflow);
  const first = await compileSkillUsagePlan({ workflow, assessment });
  const second = await compileSkillUsagePlan({
    workflow,
    assessment: { ...assessment, generatedAt: "2026-08-12T00:00:00.000Z" },
  });

  assert.equal(first.planningDepth, "standard");
  assert.equal(first.stages.length, 4);
  assert.equal(first.contentHash, second.contentHash);
  assert.notEqual(first.source.inventoryGeneratedAt, second.source.inventoryGeneratedAt);
});

test("Markdown contains only the Skill route, completion scale, alternatives, and gaps", async () => {
  const template = await loadWorkflowTemplate();
  const workflow = workflowFrom(template, { riskLevel: "high", stageCount: 1 });
  const plan = await compileSkillUsagePlan({ workflow, assessment: assessmentFor(workflow, { partial: true }) });
  const markdown = renderSkillPlanMarkdown(plan);

  assert.match(markdown, /Skill 使用方案/);
  assert.match(markdown, /主 Skill/);
  assert.match(markdown, /使用到什么程度/);
  assert.match(markdown, /待确认备选/);
  assert.match(markdown, /能力缺口/);
  assert.doesNotMatch(markdown, /Project Brief|质量门|执行进度|验证等级|锁定基线/);
});
