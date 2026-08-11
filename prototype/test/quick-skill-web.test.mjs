import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Web quick use migrates local state once and then uses shared server endpoints", async () => {
  const source = await fs.readFile(path.resolve(import.meta.dirname, "../public/app.js"), "utf8");
  assert.match(source, /\/api\/quick-skill-state\/migrate/);
  assert.match(source, /localStorage\.removeItem\(QUICK_DECK_STORAGE_KEY\)/);
  assert.match(source, /method:\s*"PATCH"[\s\S]{0,240}expectedRevision/);
  assert.match(source, /\/api\/quick-skill-deck/);
  assert.doesNotMatch(source, /saveQuickDeckPreferences\s*\(/);
});

