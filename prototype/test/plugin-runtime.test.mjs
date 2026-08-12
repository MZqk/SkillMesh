import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const PLUGIN_ROOT = path.resolve(import.meta.dirname, "../../plugins/skillmesh");

test("installed-style standalone plugin cache launches the MCP Apps runtime", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmesh-plugin-runtime-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cachedPlugin = path.join(directory, "cache", "skillmesh", "0.9.0");
  await fs.cp(PLUGIN_ROOT, cachedPlugin, { recursive: true });

  const client = new Client({ name: "skillmesh-plugin-runtime-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(cachedPlugin, "run-mcp.mjs")],
    env: {
      ...process.env,
      CAPABILITY_ATLAS_DATA_DIR: path.join(directory, "data"),
      CAPABILITY_ATLAS_HOME_DIR: path.join(directory, "home"),
    },
    stderr: "pipe",
  });
  await client.connect(transport);
  let closed = false;
  context.after(async () => {
    if (!closed) await client.close();
  });

  const tools = await client.listTools();
  const names = new Set(tools.tools.map((tool) => tool.name));
  assert.ok(names.has("open_skillmesh"));
  assert.ok(names.has("get_skillmesh_app_snapshot"));
  assert.ok(names.has("execute_skill_installation_plan"));
  assert.equal(names.has("open_web_ui"), false);
  assert.equal(names.has("open_skillmesh_widget"), false);
  assert.equal(names.has("export_workflow"), false);
  const resources = await client.listResources();
  assert.deepEqual(resources.resources.map((resource) => resource.uri), ["ui://skillmesh/workbench-v1.html"]);
  await assert.rejects(fs.access(path.join(cachedPlugin, "runtime", "server.mjs")));
  await assert.rejects(fs.access(path.join(cachedPlugin, "runtime", "public")));

  await client.close();
  closed = true;
});
