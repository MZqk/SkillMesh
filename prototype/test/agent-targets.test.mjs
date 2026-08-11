import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AGENT_TARGET_IDS,
  listAgentTargets,
  resolveAgentTarget,
} from "../lib/agent-targets.mjs";

test("resolves newly scanned Agent ecosystems to explicit managed targets", () => {
  assert.ok(AGENT_TARGET_IDS.includes("gemini-cli"));
  assert.ok(AGENT_TARGET_IDS.includes("antigravity"));
  assert.ok(AGENT_TARGET_IDS.includes("kiro"));
  assert.ok(AGENT_TARGET_IDS.includes("trae"));
  assert.ok(AGENT_TARGET_IDS.includes("opencode"));
  assert.ok(AGENT_TARGET_IDS.includes("qoderwork-cn"));

  assert.equal(resolveAgentTarget("gemini").skillsCliAgent, "gemini-cli");
  assert.equal(resolveAgentTarget("kiro-cli").path.endsWith("/.kiro/skills"), true);
  assert.equal(resolveAgentTarget("qoderwork-cn").externalInstallSupported, false);
});

test("detects an Agent application directory independently of whether it already has Skills", async (context) => {
  const homeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmesh-agent-targets-"));
  context.after(() => fs.rm(homeDirectory, { recursive: true, force: true }));
  await fs.mkdir(path.join(homeDirectory, ".gemini"), { recursive: true });
  await fs.mkdir(path.join(homeDirectory, ".config", "opencode"), { recursive: true });

  const targets = await listAgentTargets({ homeDirectory });
  assert.equal(targets.find((target) => target.id === "gemini-cli").detected, true);
  assert.equal(targets.find((target) => target.id === "opencode").detected, true);
  assert.equal(targets.find((target) => target.id === "kiro").detected, false);
});
