#!/usr/bin/env node
import { planToMarkdown } from "./lib/exporter.mjs";
import { buildPlan } from "./lib/matcher.mjs";
import { publicInventory, scanSkills } from "./lib/scanner.mjs";
import { startMcpServer } from "./mcp-server.mjs";
import { startServer } from "./server.mjs";

const [command = "help", ...args] = process.argv.slice(2);

function help() {
  console.log(`Capability Atlas 0.6

Usage:
  node cli.mjs scan [--full]
  node cli.mjs plan [goal] [--json]
  node cli.mjs serve
  node cli.mjs mcp

Skill discovery remains read-only. MCP Agents may create workflow and installation
plans, but only the web UI can approve managed Skill writes or human confirmation.`);
}

if (command === "scan") {
  const result = publicInventory(await scanSkills());
  if (args.includes("--full")) console.log(JSON.stringify(result, null, 2));
  else console.log(JSON.stringify({ generatedAt: result.generatedAt, roots: result.roots, stats: result.stats }, null, 2));
} else if (command === "plan") {
  const asJson = args.includes("--json");
  const goal = args.filter((item) => item !== "--json").join(" ") || "开发一个面向个人用户的 Web 应用";
  const plan = await buildPlan({ goal, inventory: await scanSkills() });
  console.log(asJson ? JSON.stringify(plan, null, 2) : planToMarkdown(plan));
} else if (command === "serve") {
  await startServer();
} else if (command === "mcp") {
  await startMcpServer();
} else {
  help();
  if (command !== "help" && command !== "--help" && command !== "-h") process.exitCode = 1;
}
