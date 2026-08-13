#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const prototypeRoot = path.resolve(path.dirname(scriptPath), "..");
const repositoryRoot = path.resolve(prototypeRoot, "..");
const EXPECTED_SURFACES = ["mcp-app", "agent-skill"];
const ALLOWED_STATES = new Set(["supported", "not-applicable"]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function hasNamedFrontmatter(text, name) {
  const frontmatter = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/u)?.[1] || "";
  return new RegExp(`^name:\\s*${name}\\s*$`, "mu").test(frontmatter)
    && /^description:\s*\S/mu.test(frontmatter);
}

export async function validateDeliverySurfaces({ root = repositoryRoot } = {}) {
  const prototype = path.join(root, "prototype");
  const contractPath = path.join(root, "delivery-surfaces.json");
  const contract = await readJson(contractPath);
  invariant(contract.schemaVersion === "1", "delivery surface contract schemaVersion must be 1");
  invariant(contract.product === "SkillMesh", "delivery surface contract must identify SkillMesh");
  invariant(Array.isArray(contract.supportedSurfaces), "delivery surface contract must list supportedSurfaces");

  const surfaceIds = contract.supportedSurfaces.map((surface) => surface?.id);
  invariant(surfaceIds.length === EXPECTED_SURFACES.length, "SkillMesh must expose exactly two supported delivery surfaces");
  invariant(new Set(surfaceIds).size === surfaceIds.length, "delivery surface IDs must be unique");
  invariant(EXPECTED_SURFACES.every((id) => surfaceIds.includes(id)), "supported surfaces must be MCP App and Agent Skill");
  invariant(surfaceIds.every((id) => EXPECTED_SURFACES.includes(id)), "no third delivery surface may be introduced");

  for (const surface of contract.supportedSurfaces) {
    invariant(typeof surface.entry === "string" && surface.entry.trim(), `surface ${surface.id} needs an entry`);
    invariant(Array.isArray(surface.artifacts) && surface.artifacts.length, `surface ${surface.id} needs artifacts`);
    for (const artifact of surface.artifacts) await fs.access(path.join(root, artifact));
  }

  const packageJson = await readJson(path.join(prototype, "package.json"));
  invariant(packageJson.dependencies?.["@modelcontextprotocol/ext-apps"], "MCP App mode must depend on @modelcontextprotocol/ext-apps");
  const mcpServer = await fs.readFile(path.join(prototype, "mcp-server.mjs"), "utf8");
  invariant(mcpServer.includes('from "@modelcontextprotocol/ext-apps/server"'), "MCP App mode must use ext-apps server helpers");
  invariant(mcpServer.includes("registerAppResource(") && mcpServer.includes("registerAppTool("), "MCP App mode must publish an interactive App resource and entry tool");
  invariant(mcpServer.includes('"import_agent_skill_workflow"'), "MCP App mode must accept the Agent Skill workflow handoff");

  const skillRoot = path.join(root, "skills", "map-agent-skill-workflows");
  const skillDocument = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8");
  invariant(hasNamedFrontmatter(skillDocument, "map-agent-skill-workflows"), "Agent Skill must have valid name and description frontmatter");
  const agentMetadata = await fs.readFile(path.join(skillRoot, "agents", "openai.yaml"), "utf8");
  invariant(/display_name:/u.test(agentMetadata) && /default_prompt:/u.test(agentMetadata), "Agent Skill must publish Agent metadata");

  const workflowAsset = path.join(skillRoot, "assets", "agent-skill-development-workflow.json");
  const workflow = await readJson(workflowAsset);
  invariant(workflow.id && workflow.name && workflow.version && Array.isArray(workflow.stages) && workflow.stages.length, "Agent Skill workflow asset must be importable");
  const skillScript = path.join(skillRoot, "scripts", "skillmesh.py");
  await run("python3", ["-m", "py_compile", skillScript], { cwd: root });
  const { stdout } = await run("python3", [skillScript, "validate-workflow", "--workflow", workflowAsset], { cwd: root });
  invariant(JSON.parse(stdout).valid === true, "Agent Skill workflow asset must pass its validator");

  invariant(Array.isArray(contract.capabilities) && contract.capabilities.length, "delivery surface contract must list capabilities");
  for (const capability of contract.capabilities) {
    invariant(typeof capability.id === "string" && capability.id, "every capability needs an ID");
    invariant(["required", "surface-specific"].includes(capability.synchronization), `${capability.id} has an invalid synchronization policy`);
    invariant(capability.surfaces && typeof capability.surfaces === "object", `${capability.id} must define both delivery surfaces`);
    invariant(EXPECTED_SURFACES.every((id) => capability.surfaces[id]), `${capability.id} is missing a delivery surface definition`);
    invariant(Object.keys(capability.surfaces).every((id) => EXPECTED_SURFACES.includes(id)), `${capability.id} declares an unsupported surface`);
    if (capability.synchronization === "surface-specific") {
      invariant(typeof capability.rationale === "string" && capability.rationale.trim(), `${capability.id} needs a rationale for its surface difference`);
    }
    for (const id of EXPECTED_SURFACES) {
      const surface = capability.surfaces[id];
      invariant(ALLOWED_STATES.has(surface.state), `${capability.id}/${id} has an invalid state`);
      invariant(typeof surface.implementation === "string" && surface.implementation.trim(), `${capability.id}/${id} needs an implementation note`);
      if (capability.synchronization === "required") {
        invariant(surface.state === "supported", `${capability.id} must be supported by both delivery surfaces`);
      }
    }
  }

  return {
    surfaces: surfaceIds,
    capabilities: contract.capabilities.map((capability) => capability.id),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  validateDeliverySurfaces()
    .then((result) => console.log(`SkillMesh delivery surface contract is valid (${result.surfaces.join(" + ")}; ${result.capabilities.length} capabilities).`))
    .catch((error) => {
      console.error(`SkillMesh delivery surface contract is invalid: ${error.message}`);
      process.exitCode = 1;
    });
}
