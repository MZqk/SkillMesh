import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { ExternalSkillReviewService } from "../lib/external-skill-review.mjs";

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

test("reviews one exact GitHub Skill document without loading a broad ecosystem catalog", async () => {
  const contents = [
    "---",
    "name: focused-review",
    "description: Review one explicit capability gap.",
    "allowed-tools: [Read]",
    "---",
    "Read the selected source and report evidence.",
  ].join("\n");
  const calls = [];
  const service = new ExternalSkillReviewService({
    fetcher: async (url) => {
      calls.push(url);
      if (url === "https://api.github.com/repos/example/skill-pack") {
        return jsonResponse({ full_name: "example/skill-pack", default_branch: "main" });
      }
      if (url.endsWith("/git/trees/main?recursive=1")) {
        return jsonResponse({ truncated: false, tree: [{ type: "blob", path: "skills/focused-review/SKILL.md", size: Buffer.byteLength(contents) }] });
      }
      if (url.includes("/contents/skills/focused-review/SKILL.md?ref=main")) return new Response(contents, { status: 200 });
      return new Response("not found", { status: 404 });
    },
  });

  const preview = await service.preview({
    id: "candidate-1",
    packageId: "example/skill-pack@focused-review",
  });
  assert.equal(calls.length, 3);
  assert.equal(preview.source.repository, "example/skill-pack");
  assert.equal(preview.source.path, "skills/focused-review/SKILL.md");
  assert.equal(preview.document.content, contents);
  assert.equal(preview.document.sha256, createHash("sha256").update(contents).digest("hex"));
  assert.equal(preview.frontmatter.name, "focused-review");
  assert.deepEqual(preview.frontmatter.allowedTools, ["Read"]);
  assert.equal(preview.review.severity, "none");
});

test("rejects candidates that cannot resolve to one installable package and exact Skill document", async () => {
  const noFetch = new ExternalSkillReviewService({ fetcher: async () => { throw new Error("unexpected-fetch"); } });
  await assert.rejects(noFetch.preview({ packageId: "https://example.com/unknown" }), /external-skill-package-review-unsupported/);

  const truncated = new ExternalSkillReviewService({
    fetcher: async (url) => url.endsWith("/skill-pack")
      ? jsonResponse({ full_name: "example/skill-pack", default_branch: "main" })
      : jsonResponse({ truncated: true, tree: [] }),
  });
  await assert.rejects(truncated.preview({ packageId: "example/skill-pack@focused-review" }), /external-skill-review-tree-incomplete/);
});

