import assert from "node:assert/strict";
import test from "node:test";

import { verificationContextDefaults } from "../public/playbook-ui.js";

test("prefills verification context from the locked project brief without inventing runtime results", () => {
  assert.deepEqual(verificationContextDefaults({
    projectName: "团队周计划板",
    targetPlatforms: ["Web"],
    preferredStack: ["TypeScript", "Playwright"],
  }), {
    sampleName: "团队周计划板主路径",
    environment: "目标平台：Web；技术栈：TypeScript、Playwright；记录方式：本机人工验证",
  });
});

