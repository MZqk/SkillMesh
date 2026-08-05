import assert from "node:assert/strict";
import test from "node:test";

import { ensureVirtualEnvironment } from "../scripts/setup-pdf.mjs";

test("reuses an existing PDF virtual environment and creates only when missing", async () => {
  let created = 0;
  const reused = await ensureVirtualEnvironment({
    pythonPath: "/fixture/.venv/bin/python3",
    access: async () => {},
    create: async () => { created += 1; },
  });
  assert.equal(reused, false);
  assert.equal(created, 0);

  const initialized = await ensureVirtualEnvironment({
    pythonPath: "/fixture/.venv/bin/python3",
    access: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
    create: async () => { created += 1; },
  });
  assert.equal(initialized, true);
  assert.equal(created, 1);
});
