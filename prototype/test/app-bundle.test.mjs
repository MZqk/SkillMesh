import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const BUNDLE = path.resolve(import.meta.dirname, "../dist/skillmesh-workbench.html");

test("committed MCP App bundle is self-contained, responsive, and exposes the five workbench areas", async () => {
  const html = await fs.readFile(BUNDLE, "utf8");
  assert.match(html, /text\/html|<!doctype html>/i);
  for (const label of ["测绘", "Skill 方案", "快速使用", "安装", "设置"]) assert.match(html, new RegExp(label));
  assert.match(html, /role="tab"/);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /tabindex="-1"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /ui\/message|sendMessage/);
  assert.match(html, /downloadFile/);
  assert.match(html, /external-preview/);
  assert.match(html, /review-document/);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+href=/i);
  assert.doesNotMatch(html, /window\.openai|sendFollowUpMessage/);
});
