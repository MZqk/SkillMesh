import assert from "node:assert/strict";
import test from "node:test";

import { findExternalSkills, parseSkillSearchOutput } from "../lib/skill-search.mjs";

test("parses bounded external Skill candidates without treating them as installed", () => {
  const candidates = parseSkillSearchOutput(`
\u001b[32mandroid/skills@compose\u001b[0m 6.5K installs
https://skills.sh/android/skills/compose
github/awesome-copilot@agentic-eval 9,900 installs
https://skills.sh/github/awesome-copilot/agentic-eval
`, { query: "android compose" });

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].packageId, "android/skills@compose");
  assert.equal(candidates[0].installCount, 6_500);
  assert.match(candidates[0].securityNotes, /安装前/);
});

test("external search uses the Skills CLI with fixed arguments and never installs", async () => {
  let invocation;
  const result = await findExternalSkills("android compose", {
    runner: async (command, args, options) => {
      invocation = { command, args, options };
      return { stdout: "android/skills@compose 6.5K installs\nhttps://skills.sh/android/skills/compose\n", stderr: "" };
    },
  });

  assert.deepEqual(invocation.args, ["-y", "skills", "find", "android compose"]);
  assert.equal(result.installPerformed, false);
  assert.equal(result.candidates[0].packageId, "android/skills@compose");
});
