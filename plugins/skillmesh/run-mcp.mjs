#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

const runtimeRoot = path.resolve(import.meta.dirname, "runtime");
const mcpServerPath = path.join(runtimeRoot, "mcp-server.mjs");
process.env.SKILLMESH_ENABLE_AGENT_SKILL_HANDOFF = "false";
const { startMcpServer } = await import(pathToFileURL(mcpServerPath));

await startMcpServer();
