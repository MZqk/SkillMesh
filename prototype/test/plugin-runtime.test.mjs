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
  const cachedPlugin = path.join(directory, "cache", "skillmesh", "0.7.0");
  await fs.cp(PLUGIN_ROOT, cachedPlugin, { recursive: true });

  const client = new Client({ name: "skillmesh-plugin-runtime-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(cachedPlugin, "run-mcp.mjs")],
    env: {
      ...process.env,
      CAPABILITY_ATLAS_DATA_DIR: path.join(directory, "data"),
      CAPABILITY_ATLAS_HOME_DIR: path.join(directory, "home"),
      CAPABILITY_ATLAS_WEB_AUTOSTART: "0",
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
  assert.ok(names.has("get_quick_skill_deck"));
  assert.ok(names.has("open_skillmesh_widget"));
  assert.ok(names.has("update_quick_skill_state"));
  const resources = await client.listResources();
  assert.ok(resources.resources.some((resource) => resource.uri === "ui://skillmesh/quick-use-v1.html"));

  await client.close();
  closed = true;
});
