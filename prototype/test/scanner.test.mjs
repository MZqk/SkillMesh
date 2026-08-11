import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { publicInventory, scanSkills } from "../lib/scanner.mjs";

test("reports logical aliases, content copies, and same-name conflicts", async (context) => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "capability-atlas-scanner-"));
  context.after(() => fs.rm(rootPath, { recursive: true, force: true }));

  const original = path.join(rootPath, "original");
  const conflicting = path.join(rootPath, "conflicting");
  await fs.mkdir(original);
  await fs.mkdir(conflicting);
  await fs.writeFile(
    path.join(original, "SKILL.md"),
    "---\nname: alpha\ndescription: Research evidence.\n---\nBody A\n",
  );
  await fs.writeFile(
    path.join(conflicting, "SKILL.md"),
    "---\nname: alpha\ndescription: Build a frontend.\n---\nBody B\n",
  );
  await fs.symlink(original, path.join(rootPath, "alias"), "dir");

  const inventory = await scanSkills({
    roots: [{
      path: rootPath,
      provider: "test",
      scope: "fixture",
      label: "Fixture root",
      stability: "test",
      sourceKind: "direct",
    }],
  });

  assert.equal(inventory.readOnly, true);
  assert.equal(inventory.stats.paths, 3);
  assert.equal(inventory.stats.uniqueContent, 2);
  assert.equal(inventory.stats.duplicateContentGroups, 1);
  assert.equal(inventory.stats.nameConflictGroups, 1);
  assert.equal(inventory.stats.physicalAliasGroups, 1);
  assert.equal(inventory.skills.filter((skill) => skill.isAlias).length, 1);
  assert.ok(inventory.skills.every((skill) => skill.identity.nameConflict));
  assert.ok(inventory.skills.every((skill) => skill.rootStability === "test"));

  const redacted = publicInventory(inventory);
  assert.ok(redacted.skills.every((skill) => !("searchText" in skill)));
});

test("honors disabled metadata and skips nested cross-agent distribution mirrors", async (context) => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "capability-atlas-registry-"));
  context.after(() => fs.rm(rootPath, { recursive: true, force: true }));
  await fs.mkdir(path.join(rootPath, "package", ".cursor", "skills", "copy"), { recursive: true });
  await fs.mkdir(path.join(rootPath, "package", "primary"), { recursive: true });
  const document = "---\nname: registry-fixture\ndescription: Registry fixture.\ndisable: true\nagents: [codex]\nallowed-tools:\n  - Read\ntriggers: [review code]\ninvocation: /registry-fixture\n---\nBody\n";
  await fs.writeFile(path.join(rootPath, "package", "primary", "SKILL.md"), document);
  await fs.writeFile(path.join(rootPath, "package", ".cursor", "skills", "copy", "SKILL.md"), document);

  const inventory = await scanSkills({
    roots: [{
      path: rootPath,
      provider: "test",
      scope: "fixture",
      label: "Fixture root",
      stability: "test",
      sourceKind: "direct",
      supportedAgents: ["test"],
    }],
  });

  assert.equal(inventory.stats.paths, 1);
  assert.equal(inventory.stats.disabled, 1);
  assert.equal(inventory.skills[0].enabled, false);
  assert.deepEqual(inventory.skills[0].supportedAgents, ["codex"]);
  assert.deepEqual(inventory.skills[0].allowedTools, ["Read"]);
  assert.deepEqual(inventory.skills[0].triggers, ["review code"]);
  assert.equal(inventory.skills[0].invocation, "/registry-fixture");
});
