import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { SKILLMESH_APP_URI } from "../mcp-server.mjs";

const SERVER_PATH = path.resolve(import.meta.dirname, "../mcp-server.mjs");

function output(result) {
  const block = result.content?.find((item) => item.type === "text");
  return result.structuredContent || JSON.parse(block.text);
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function portIsClosed(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(true));
    socket.setTimeout(500, () => { socket.destroy(); resolve(true); });
  });
}

test("publishes one native workbench and App-only human actions without starting HTTP", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmesh-mcp-app-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const home = path.join(directory, "home");
  const skillRoot = path.join(home, ".workbuddy", "skills", "requirements-guide");
  await fs.mkdir(skillRoot, { recursive: true });
  await fs.writeFile(path.join(skillRoot, "SKILL.md"), [
    "---",
    "name: requirements-guide",
    "description: Clarify requirements and acceptance criteria for delivery workflows.",
    "supported-agents: [workbuddy]",
    "---",
    "# Requirements Guide",
  ].join("\n"));
  const unusedPort = await availablePort();
  const client = new Client({ name: "WorkBuddy", version: "5.3.11" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: {
      ...process.env,
      CAPABILITY_ATLAS_DATA_DIR: path.join(directory, "data"),
      CAPABILITY_ATLAS_HOME_DIR: home,
      CAPABILITY_ATLAS_WEB_PORT: String(unusedPort),
      CAPABILITY_ATLAS_WEB_AUTOSTART: "1",
    },
    stderr: "pipe",
  });
  await client.connect(transport);
  let closed = false;
  context.after(async () => { if (!closed) await client.close(); });

  assert.equal(await portIsClosed(unusedPort), true);

  const listed = await client.listTools();
  const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));
  assert.equal(byName.get("open_skillmesh")._meta.ui.resourceUri, SKILLMESH_APP_URI);
  assert.deepEqual(byName.get("open_skillmesh")._meta.ui.visibility, ["model"]);
  assert.equal(Object.keys(byName.get("open_skillmesh")._meta).some((key) => key.startsWith("openai/")), false);
  for (const name of [
    "get_skillmesh_app_snapshot",
    "review_skill_match",
    "record_skill_validation",
    "update_workflow_confirmation_fields",
    "confirm_workflow",
    "update_skillmesh_preferences",
    "update_skill_roots",
    "configure_skill_installation_plan",
    "execute_skill_installation_plan",
    "cancel_skill_installation_job",
    "acknowledge_skill_installation_warnings",
    "quarantine_skill_installation_item",
    "resolve_skill_installation_repair",
    "prepare_skill_usage_plan_export",
  ]) {
    assert.deepEqual(byName.get(name)?._meta?.ui?.visibility, ["app"], name);
    assert.equal(byName.get(name)?._meta?.ui?.resourceUri, SKILLMESH_APP_URI, name);
  }
  for (const removed of ["open_web_ui", "open_skillmesh_widget", "get_quick_skill_deck", "update_quick_skill_state", "export_workflow"]) {
    assert.equal(byName.has(removed), false, removed);
  }
  assert.ok(byName.has("search_skills"));
  assert.ok(byName.has("create_requirement_workflow_draft"));
  assert.ok(byName.has("get_skill_usage_plan"));
  assert.ok(byName.has("propose_skill_installation_plan"));

  const resources = await client.listResources();
  assert.deepEqual(resources.resources.map((resource) => resource.uri), [SKILLMESH_APP_URI]);
  const resource = await client.readResource({ uri: SKILLMESH_APP_URI });
  const html = resource.contents[0];
  assert.equal(html.mimeType, "text/html;profile=mcp-app");
  assert.match(html.text, /把 Skill 放回工作流/);
  assert.match(html.text, /快速使用/);
  assert.equal(html._meta.ui.csp.connectDomains.length, 0);
  assert.equal(html._meta.ui.csp.resourceDomains.length, 0);
  assert.equal(Object.keys(html._meta).some((key) => key.startsWith("openai/")), false);

  const created = output(await client.callTool({
    name: "create_workflow_draft",
    arguments: {
      goal: "澄清并交付一个功能需求",
      scopeDescription: "由本机 Agent 完成结构化需求交付。",
      nonGoals: ["不扩大需求范围"],
      acceptanceCriteria: ["需求与验收条件可观察"],
      requirement: { targetAgents: ["workbuddy"], riskLevel: "low" },
      stages: [{
        id: "clarify",
        phase: "定义",
        title: "澄清需求",
        capabilities: [{ id: "requirements", label: "需求澄清", terms: ["requirements", "acceptance criteria"] }],
      }],
    },
  }));
  const assessment = output(await client.callTool({ name: "assess_workflow", arguments: { id: created.id, refresh: true, targetAgent: "workbuddy" } }));
  const candidate = assessment.stages[0].candidates.find((item) => item.name === "requirements-guide");
  assert.ok(candidate);

  const opened = await client.callTool({
    name: "open_skillmesh",
    arguments: { workflowId: created.id, stageId: "clarify", targetAgents: ["workbuddy"] },
  });
  assert.match(opened.content[0].text, /当前宿主 WorkBuddy/);
  assert.equal(opened.structuredContent.host.id, "workbuddy");
  assert.equal(opened.structuredContent.featurePolicy.readOnly, false);
  assert.equal(opened.structuredContent.workflows.activeId, created.id);
  assert.equal(opened.structuredContent.skillPlan.mappingScope.currentAgent, "workbuddy");
  assert.equal(opened.structuredContent.quickUse.targetAgent.id, "workbuddy");

  const reviewed = output(await client.callTool({
    name: "review_skill_match",
    arguments: {
      kind: "local",
      workflowId: created.id,
      expectedRevision: created.revision,
      stageId: "clarify",
      contentHash: candidate.contentHash,
      decision: "confirmed",
      rationale: "用户在原生 App 中确认了强证据。",
    },
  }));
  assert.equal(reviewed.reviews.clarify[candidate.contentHash].actor.type, "human");
  assert.equal(reviewed.reviews.clarify[candidate.contentHash].actor.channel, "mcp-app");

  const validated = output(await client.callTool({
    name: "record_skill_validation",
    arguments: {
      workflowId: created.id,
      expectedRevision: reviewed.revision,
      contentHash: candidate.contentHash,
      agent: "WorkBuddy",
      environment: "fixture macOS",
      notes: "人工运行并观察到预期输出。",
    },
  }));
  assert.equal(validated.validations[candidate.contentHash].actor.channel, "mcp-app");

  const confirmed = output(await client.callTool({
    name: "confirm_workflow",
    arguments: { workflowId: created.id, expectedRevision: validated.revision },
  }));
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.confirmedBy.type, "human");
  assert.equal(confirmed.confirmedBy.channel, "mcp-app");

  const currentPlan = output(await client.callTool({
    name: "get_skill_usage_plan",
    arguments: { workflowId: created.id, targetAgents: ["workbuddy"] },
  }));
  assert.equal(currentPlan.contentHash.length, 64);
  const exported = output(await client.callTool({
    name: "prepare_skill_usage_plan_export",
    arguments: {
      workflowId: created.id,
      targetAgents: ["workbuddy"],
      contentHash: currentPlan.contentHash,
      format: "markdown",
    },
  }));
  assert.equal(exported.filename, "skill-usage-plan.md");
  assert.equal(exported.contentHash, currentPlan.contentHash);
  assert.match(exported.text, /Skill 使用方案/);

  const settings = opened.structuredContent.settings;
  const updatedSettings = output(await client.callTool({
    name: "update_skill_roots",
    arguments: { expectedRevision: settings.revision, customRoots: [path.join(directory, "extra-skills")] },
  }));
  assert.equal(updatedSettings.revision, settings.revision + 1);
  const staleSettings = await client.callTool({
    name: "update_skill_roots",
    arguments: { expectedRevision: settings.revision, customRoots: [] },
  });
  assert.equal(staleSettings.isError, true);
  assert.match(staleSettings.content[0].text, /settings-revision-conflict/);

  const prompts = await client.listPrompts();
  assert.ok(prompts.prompts.some((prompt) => prompt.name === "map_requirement_to_workflow"));
  const prompt = await client.getPrompt({ name: "map_requirement_to_workflow", arguments: { goal: "开发一个产品" } });
  assert.match(prompt.messages[0].content.text, /open_skillmesh/);
  assert.doesNotMatch(prompt.messages[0].content.text, /open_web_ui/);

  await client.close();
  closed = true;
});
