#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

const runtimeRoot = path.resolve(import.meta.dirname, "runtime");
const mcpServerPath = path.join(runtimeRoot, "mcp-server.mjs");
const webServerPath = path.join(runtimeRoot, "server.mjs");
const { startMcpServer } = await import(pathToFileURL(mcpServerPath));

await startMcpServer({ webUiOptions: { serverPath: webServerPath } });
