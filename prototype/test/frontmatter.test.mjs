import assert from "node:assert/strict";
import test from "node:test";

import { parseSkillDocument } from "../lib/frontmatter.mjs";

test("parses the small, safe frontmatter subset used by Skill metadata", () => {
  const parsed = parseSkillDocument(`---
name: research-helper
description: >
  Finds evidence and
  writes a concise report.
version: "1.2.0"
---
# Instructions
Never executed by the scanner.
`);

  assert.equal(parsed.name, "research-helper");
  assert.equal(parsed.description, "Finds evidence and writes a concise report.");
  assert.equal(parsed.metadata.version, "1.2.0");
  assert.match(parsed.body, /Never executed/);
  assert.deepEqual(parsed.diagnostics, []);
});

test("falls back without interpreting a document that has no frontmatter", () => {
  const parsed = parseSkillDocument("# Plain instructions\nDo a thing.", "folder-name");

  assert.equal(parsed.name, "folder-name");
  assert.equal(parsed.description, "");
  assert.deepEqual(parsed.diagnostics, ["frontmatter-missing"]);
});

test("parses booleans and bounded top-level lists used by Agent Skill manifests", () => {
  const parsed = parseSkillDocument(`---
name: disabled-helper
description: Fixture.
disable: true
allowed-tools:
  - Read
  - Grep
agents: [codex, "claude"]
---
Body
`);

  assert.equal(parsed.metadata.disable, true);
  assert.deepEqual(parsed.metadata["allowed-tools"], ["Read", "Grep"]);
  assert.deepEqual(parsed.metadata.agents, ["codex", "claude"]);
});
