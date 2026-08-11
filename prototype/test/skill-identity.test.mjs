import assert from "node:assert/strict";
import test from "node:test";

import { canonicalSkills } from "../lib/skill-identity.mjs";

test("merges Agent ownership across identical Skill content copies", () => {
  const base = {
    contentHash: "same-content",
    name: "shared-review",
    description: "Review a plan.",
    scope: "user",
    sourceKind: "direct",
    metadataStatus: "complete",
    enabled: true,
    identity: { duplicateContent: true },
  };
  const [merged] = canonicalSkills([
    { ...base, id: "claude-copy", provider: "claude", path: "/home/.claude/skills/review/SKILL.md", supportedAgents: ["claude"] },
    { ...base, id: "codex-copy", provider: "codex", path: "/home/.codex/skills/review/SKILL.md", supportedAgents: ["codex"] },
    { ...base, id: "cursor-copy", provider: "cursor", path: "/home/.cursor/skills/review/SKILL.md", supportedAgents: ["cursor"] },
  ]);

  assert.equal(merged.provider, "claude");
  assert.deepEqual(merged.providers, ["claude", "codex", "cursor"]);
  assert.deepEqual(merged.supportedAgents, ["claude", "codex", "cursor"]);
  assert.equal(merged.identity.contentCopies, 3);
  assert.equal(merged.identity.enabledCopies, 3);
});
