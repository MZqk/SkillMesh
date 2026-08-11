import assert from "node:assert/strict";
import test from "node:test";

import { normalizePlaybookInput } from "../lib/playbook-model.mjs";
import { bindSkillsToPlaybook } from "../lib/playbook-skill-binder.mjs";

test("binds a primary Skill, alternatives, evidence rationale, and explicit capability gaps per step", () => {
  const playbook = {
    workflowId: "workflow-1",
    title: "测试手册",
    source: { workflowId: "workflow-1", projectBriefVersion: 1 },
    stages: [{
      id: "frame-direction",
      title: "把方向变成问题",
      mode: "vibe",
      steps: [{
        id: "identify-user-problem",
        title: "写清用户问题",
        objective: "形成问题陈述。",
        requiredCapabilities: ["discovery", "problem-framing"],
        actions: ["研究用户"],
        prompt: "请研究用户问题",
        expectedOutputs: ["问题陈述"],
        acceptanceCriteria: ["问题可证伪"],
        failureModes: [{ symptom: "只有方案", recovery: "回到用户行为" }],
      }],
      qualityGate: { criteria: ["问题明确"] },
    }],
  };
  const assessment = {
    schemaVersion: "0.2",
    generatedAt: "2026-08-04T00:00:00.000Z",
    scoring: { version: "lexical-evidence-v2" },
    workflow: { revision: 3 },
    summary: { inventoryUniqueContent: 42 },
    stages: [{
      id: "frame-direction",
      capabilityCoverage: [
        { id: "discovery", label: "用户研究", status: "confirmed", gapQuery: "" },
        {
          id: "problem-framing",
          label: "问题界定",
          status: "uncertain",
          gapQuery: "problem framing",
          externalCandidates: [{ skillName: "external-framing", packageId: "example/framing", status: "accepted" }],
        },
      ],
      candidates: [
        {
          id: "hash-research",
          contentHash: "hash-research",
          name: "user-research",
          score: 0.91,
          confidence: 0.8,
          decision: "confirmed",
          readiness: "human-verified",
          warnings: [],
          path: "/private/should-not-leak",
          capabilityScores: [{ capabilityId: "discovery", strength: "strong" }],
        },
        {
          id: "hash-framing",
          contentHash: "hash-framing",
          name: "problem-helper",
          score: 0.64,
          confidence: 0.45,
          decision: "unreviewed",
          readiness: "unverified",
          warnings: [],
          capabilityScores: [{ capabilityId: "problem-framing", strength: "weak" }],
        },
      ],
    }],
  };

  const bound = bindSkillsToPlaybook({ playbook, assessment });
  const normalized = normalizePlaybookInput(bound, { id: "playbook-1", workflowId: "workflow-1" });
  const step = normalized.stages[0].steps[0];

  assert.equal(step.skillBindings[0].role, "primary");
  assert.equal(step.skillBindings[0].name, "user-research");
  assert.equal(step.skillBindings[0].readiness, "ready");
  assert.equal(step.skillBindings[0].reviewStatus, "confirmed");
  assert.match(step.skillBindings[0].rationale, /用户研究/);
  assert.equal(step.skillBindings[0].usageLevel, "required");
  assert.deepEqual(step.skillBindings[0].responsibilities, ["用户研究"]);
  assert.match(step.skillBindings[0].completionCriteria.join(" "), /问题可证伪/);
  assert.equal(step.skillBindings[1].usageLevel, "fallback");
  assert.equal(step.skillBindings[1].reviewStatus, "suggested");
  assert.equal(step.skillBindings[1].role, "alternative");
  assert.equal(step.skillBindings[1].readiness, "attention");
  assert.equal(step.skillGaps[0].capabilityId, "problem-framing");
  assert.equal(step.skillGaps[0].status, "uncertain");
  assert.equal(step.skillGaps[0].externalCandidates[0].name, "external-framing");
  assert.equal(normalized.skillBindingAssessment.inventoryUniqueContent, 42);
  assert.doesNotMatch(JSON.stringify(normalized), /should-not-leak/);
});

test("keeps unreviewed strong evidence as an alternative instead of a trusted primary", () => {
  const playbook = {
    workflowId: "workflow-2",
    title: "安全绑定测试",
    source: { workflowId: "workflow-2", projectBriefVersion: 1 },
    stages: [{
      id: "build",
      title: "实现",
      mode: "engineer",
      steps: [{
        id: "implement",
        title: "实现功能",
        objective: "交付功能。",
        requiredCapabilities: ["implementation"],
        actions: ["编码"],
        prompt: "实现功能",
        expectedOutputs: ["代码"],
        acceptanceCriteria: ["测试通过"],
        failureModes: [{ symptom: "测试失败", recovery: "修复" }],
      }],
      qualityGate: { criteria: ["测试通过"] },
    }],
  };
  const assessment = {
    schemaVersion: "0.2",
    generatedAt: "2026-08-09T00:00:00.000Z",
    scoring: { version: "lexical-evidence-v2" },
    workflow: { revision: 1 },
    summary: { inventoryUniqueContent: 1 },
    stages: [{
      id: "build",
      capabilityCoverage: [{
        id: "implementation",
        label: "工程实现",
        status: "evidenced",
        gapQuery: "implementation",
      }],
      candidates: [{
        id: "hash-code-helper",
        contentHash: "hash-code-helper",
        name: "code-helper",
        score: 0.96,
        confidence: 0.88,
        decision: "unreviewed",
        readiness: "unverified",
        warnings: [],
        capabilityScores: [{ capabilityId: "implementation", strength: "strong" }],
      }],
    }],
  };

  const bound = bindSkillsToPlaybook({ playbook, assessment });
  const step = bound.stages[0].steps[0];

  assert.equal(step.skillBindings.length, 1);
  assert.equal(step.skillBindings[0].role, "alternative");
  assert.equal(step.skillBindings[0].reviewStatus, "suggested");
  assert.equal(step.skillGaps.length, 1);
  assert.equal(step.skillGaps[0].status, "uncertain");
});
