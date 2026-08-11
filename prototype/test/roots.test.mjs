import assert from "node:assert/strict";
import test from "node:test";

import { customSkillRoots, defaultSkillRoots } from "../lib/roots.mjs";

test("includes named Agent ecosystems with evidence-level metadata", () => {
  const roots = defaultSkillRoots({
    homeDirectory: "/Users/fixture",
    projectRoot: "/work/project",
  });
  const providers = new Set(roots.map((root) => root.provider));

  for (const provider of [
    "codex",
    "claude",
    "cursor",
    "gemini-cli",
    "antigravity",
    "antigravity-cli",
    "kiro",
    "trae",
    "opencode",
    "windsurf",
    "cline",
    "continue",
    "github-copilot",
    "workbuddy",
    "qoderwork-global",
    "qoderwork-cn",
    "hermes",
    "openclaw",
  ]) {
    assert.ok(providers.has(provider), `missing ${provider}`);
  }
  assert.equal(
    roots.find((root) => root.provider === "workbuddy").stability,
    "observed",
  );
  assert.equal(
    roots.find((root) => root.label === "Gemini CLI 插件 Skill").sourceKind,
    "derived",
  );
  assert.deepEqual(
    roots.find((root) => root.label === "项目 Kiro Skill").supportedAgents,
    ["kiro"],
  );
});

test("normalizes, deduplicates, and bounds custom roots", () => {
  const roots = customSkillRoots(["~/team/skills", "~/team/skills", "/work/other-skills"], {
    homeDirectory: "/Users/fixture",
  });

  assert.deepEqual(roots.map((root) => root.path), [
    "/Users/fixture/team/skills",
    "/work/other-skills",
  ]);
  assert.throws(
    () => customSkillRoots(["~"], { homeDirectory: "/Users/fixture" }),
    /custom-root-too-broad/,
  );
  assert.throws(() => customSkillRoots(Array(21).fill("/work/skills")), /too-many-custom-roots/);
});
