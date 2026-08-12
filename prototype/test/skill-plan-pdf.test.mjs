import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { renderSkillPlanPdf } from "../lib/skill-plan-pdf.mjs";

test("PDF bridge sends only the Skill plan snapshot to the isolated renderer", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmesh-plan-pdf-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const scriptPath = path.join(directory, "renderer.py");
  await fs.writeFile(scriptPath, [
    "import json, sys",
    "payload = json.load(sys.stdin)",
    "assert payload['schemaVersion'] == '1'",
    "assert payload['contentHash'] == 'fixture-hash'",
    "assert 'playbook' not in payload and 'projectBrief' not in payload",
    "sys.stdout.buffer.write(b'%PDF-1.7\\n% skill-plan-only\\n')",
    "",
  ].join("\n"));
  const pdf = await renderSkillPlanPdf({
    schemaVersion: "1",
    contentHash: "fixture-hash",
    title: "Skill 使用方案",
    source: {},
    summaryCounts: {},
    stages: [],
    gaps: [],
  }, { python: "python3", scriptPath });
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
});
