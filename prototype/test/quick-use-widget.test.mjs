import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { runQuickUseHandoff, validateQuickUseForm } from "../widget/quick-use-actions.js";

test("Widget form requires a task and at least one expected output", () => {
  assert.deepEqual(validateQuickUseForm({ task: "", expectedOutputs: ["报告"] }).field, "task");
  assert.deepEqual(validateQuickUseForm({ task: "检查", expectedOutputs: [] }).field, "outputs");
  const valid = validateQuickUseForm({ task: " 检查登录 ", expectedOutputs: ["报告", "报告", " 修复建议 "] });
  assert.equal(valid.valid, true);
  assert.equal(valid.task, "检查登录");
  assert.deepEqual(valid.expectedOutputs, ["报告", "修复建议"]);
});

test("Widget records recent use only after ui/message succeeds", async () => {
  let sent = 0;
  let recorded = 0;
  await assert.rejects(runQuickUseHandoff({
    send: async () => { sent += 1; throw new Error("ui/message rejected"); },
    recordUse: async () => { recorded += 1; },
  }), /ui\/message rejected/);
  assert.equal(sent, 1);
  assert.equal(recorded, 0);

  const success = await runQuickUseHandoff({
    send: async () => { sent += 1; },
    recordUse: async () => { recorded += 1; },
  });
  assert.deepEqual(success, { sent: true, synced: true, syncError: null });
  assert.equal(sent, 2);
  assert.equal(recorded, 1);
});

test("Widget reports a sync warning without sending the message twice", async () => {
  let sent = 0;
  let recorded = 0;
  const result = await runQuickUseHandoff({
    send: async () => { sent += 1; },
    recordUse: async () => { recorded += 1; throw new Error("revision conflict"); },
  });
  assert.equal(result.sent, true);
  assert.equal(result.synced, false);
  assert.match(result.syncError.message, /revision conflict/);
  assert.equal(sent, 1);
  assert.equal(recorded, 1);
});

test("committed Widget bundle is single-file, keyboard-aware, responsive, and has no external assets", async () => {
  const html = await fs.readFile(path.resolve(import.meta.dirname, "../dist/quick-use-widget.html"), "utf8");
  assert.match(html, /text\/html|<!doctype html>/i);
  assert.match(html, /prefers-color-scheme:\s*dark/);
  assert.match(html, /data-theme=.{0,8}dark/);
  assert.match(html, /data-theme=.{0,8}light/);
  assert.match(html, /max-width:\s*620px/);
  assert.match(html, /Escape/);
  assert.equal((html.match(/<!doctype html>/gi) || []).length, 1);
  const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(inlineScript, "Widget must contain one inline script");
  assert.doesNotThrow(() => new vm.Script(inlineScript, { filename: "quick-use-widget.js" }));
  assert.doesNotMatch(html, /<script\s+[^>]*src=/i);
  assert.doesNotMatch(html, /<link\s+[^>]*href=/i);
});
