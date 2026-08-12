import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createMcpServer } from "../mcp-server.mjs";
import { WorkflowStore } from "../lib/workflow-store.mjs";

function output(result) {
  return result.structuredContent || JSON.parse(result.content.find((item) => item.type === "text").text);
}

test("App-only external review rejects changed content and stores an exact human acceptance", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmesh-external-mcp-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new WorkflowStore({ filePath: path.join(directory, "workspace.json") });
  let currentHash = "a".repeat(64);
  const externalReviews = {
    preview: async (candidate) => ({
      candidateId: candidate.id,
      packageId: candidate.packageId,
      source: { repository: "example/skill-pack", branch: "main", path: "skills/focused-review/SKILL.md" },
      document: { content: "# reviewed", sha256: currentHash, bytes: 10, lines: 1 },
      review: { severity: "low", findings: [] },
    }),
  };
  const instance = createMcpServer({ store, externalReviews });
  await store.initialize();
  const client = new Client({ name: "WorkBuddy", version: "5.3.11" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([instance.server.connect(serverTransport), client.connect(clientTransport)]);
  context.after(() => client.close());

  const workflow = output(await client.callTool({
    name: "create_workflow_draft",
    arguments: {
      goal: "补齐一个明确缺口",
      stages: [{ id: "build", title: "构建", capabilities: [{ id: "focused", label: "专注审阅" }] }],
    },
  }));
  const recorded = output(await client.callTool({
    name: "record_external_skill_candidate",
    arguments: {
      id: workflow.id,
      expectedRevision: workflow.revision,
      stageId: "build",
      capabilityId: "focused",
      packageId: "example/skill-pack@focused-review",
      skillName: "focused-review",
      rationale: "补齐专注审阅缺口",
    },
  }));
  const candidate = recorded.externalCandidates[0];
  const preview = output(await client.callTool({
    name: "review_skill_match",
    arguments: { kind: "external-preview", workflowId: workflow.id, candidateId: candidate.id },
  }));
  assert.equal(preview.document.sha256, "a".repeat(64));

  currentHash = "b".repeat(64);
  const changed = await client.callTool({
    name: "review_skill_match",
    arguments: {
      kind: "external-decision",
      workflowId: workflow.id,
      expectedRevision: recorded.revision,
      candidateId: candidate.id,
      decision: "accepted",
      reviewedContentHash: preview.document.sha256,
    },
  });
  assert.equal(changed.isError, true);
  assert.match(changed.content[0].text, /external-reviewed-content-changed/);

  currentHash = "a".repeat(64);
  const accepted = output(await client.callTool({
    name: "review_skill_match",
    arguments: {
      kind: "external-decision",
      workflowId: workflow.id,
      expectedRevision: recorded.revision,
      candidateId: candidate.id,
      decision: "accepted",
      reviewedContentHash: preview.document.sha256,
    },
  }));
  assert.equal(accepted.externalCandidates[0].status, "accepted");
  assert.equal(accepted.externalCandidates[0].reviewedContentHash, "a".repeat(64));
  assert.equal(accepted.externalCandidates[0].actor.type, "human");
  assert.equal(accepted.externalCandidates[0].actor.channel, "mcp-app");
});

