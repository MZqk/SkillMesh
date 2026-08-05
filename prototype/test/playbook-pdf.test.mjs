import assert from "node:assert/strict";
import test from "node:test";

import { pdfPythonCandidates, renderPlaybookPdf } from "../lib/playbook-pdf.mjs";

test("prefers an explicit PDF Python while retaining project and system fallbacks", () => {
  const candidates = pdfPythonCandidates({
    pythonExecutable: "/custom/python",
    env: {
      CAPABILITY_ATLAS_PDF_PYTHON: "/configured/python",
      VIRTUAL_ENV: "/active/venv",
    },
  });
  assert.equal(candidates[0], "/custom/python");
  assert.equal(candidates[1], "/configured/python");
  assert.equal(candidates.some((candidate) => candidate.includes("prototype/.venv")), true);
  assert.equal(candidates.includes("/active/venv/bin/python3"), process.platform !== "win32");
});

test("passes the exact Playbook and frozen Brief to a bounded PDF renderer", async () => {
  const source = {
    playbook: { id: "playbook-1", contentHash: "abc123" },
    projectBrief: { id: "brief-1", frozenVersion: 2 },
    verification: { currentLevel: "sample-run", records: [{ id: "verification-1" }] },
  };
  let received = null;
  const result = await renderPlaybookPdf(source, {
    pythonExecutable: "/fake/python",
    scriptPath: new URL("../scripts/render-playbook-pdf.py", import.meta.url).pathname,
    processRunner: async (command, scriptPath, payload) => {
      received = { command, scriptPath, payload };
      return { kind: "success", pdf: Buffer.from("%PDF-1.7\n") };
    },
  });
  assert.equal(result.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.equal(received.command, "/fake/python");
  assert.deepEqual(received.payload, source);
});

test("reports the opt-in setup command when no ReportLab runtime is available", async () => {
  await assert.rejects(
    renderPlaybookPdf({ playbook: { id: "p" }, projectBrief: { id: "b" }, verification: {} }, {
      pythonExecutable: "/missing/python",
      scriptPath: new URL("../scripts/render-playbook-pdf.py", import.meta.url).pathname,
      env: {},
      processRunner: async () => ({ kind: "missing-dependency" }),
    }),
    /pdf-renderer-unavailable:run-npm-setup-pdf/,
  );
});
