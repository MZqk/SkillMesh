import assert from "node:assert/strict";
import test from "node:test";

import { SkillMeshAppService } from "../lib/app-service.mjs";
import { humanAppActor, resolveMcpHost } from "../lib/host-agent.mjs";

test("normalizes WorkBuddy and Codex client identities without guessing unknown hosts", () => {
  assert.deepEqual(resolveMcpHost({ name: "WorkBuddy", version: "5.3.11" }), {
    id: "workbuddy",
    label: "WorkBuddy",
    currentAgent: "workbuddy",
    recognized: true,
    clientName: "WorkBuddy",
    clientVersion: "5.3.11",
  });
  assert.equal(resolveMcpHost({ name: "OpenAI Codex Desktop" }).currentAgent, "codex");
  const unknown = resolveMcpHost({ name: "Fixture Host" });
  assert.equal(unknown.recognized, false);
  assert.equal(unknown.currentAgent, null);
  assert.deepEqual(humanAppActor({ name: "WorkBuddy", version: "5.3.11" }), {
    type: "human",
    name: "local-user",
    version: "5.3.11",
    channel: "mcp-app",
  });
});

test("native App snapshot makes unknown hosts read-only", async () => {
  const appService = new SkillMeshAppService({
    store: {
      getSettings: async () => ({ customRoots: [], revision: 0 }),
    },
    service: {
      inventory: async () => ({ generatedAt: "2026-08-12T00:00:00Z", stats: { paths: 0, uniqueContent: 0, enabled: 0, disabled: 0, providers: {} } }),
    },
    installations: {
      status: async () => ({ targets: [], activeJob: null }),
    },
    quickSkills: {
      snapshot: async ({ targetAgent }) => ({
        targetAgent: { id: targetAgent },
        context: { workflowId: null, stageId: null },
        workflowOptions: [],
        sections: { current: { items: [] }, favorites: { items: [] }, recent: { items: [] } },
      }),
    },
  });
  const unknown = await appService.snapshot({}, { name: "Fixture Host" });
  assert.equal(unknown.host.recognized, false);
  assert.equal(unknown.featurePolicy.readOnly, true);
  assert.equal(unknown.quickUse.targetAgent.id, "unknown");
  assert.equal(unknown.quickUse.sections.current.items.length, 0);
  const workbuddy = await appService.snapshot({}, { name: "WorkBuddy" });
  assert.equal(workbuddy.featurePolicy.readOnly, false);
  assert.equal(workbuddy.quickUse.targetAgent.id, "workbuddy");
});
