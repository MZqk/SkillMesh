import fs from "node:fs/promises";
import path from "node:path";

const prototypeRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(prototypeRoot, "..");
const pluginRoot = path.join(repositoryRoot, "plugins", "skillmesh");
const manifest = JSON.parse(await fs.readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
const mcp = JSON.parse(await fs.readFile(path.join(pluginRoot, ".mcp.json"), "utf8"));
const marketplace = JSON.parse(await fs.readFile(path.join(repositoryRoot, ".agents", "plugins", "marketplace.json"), "utf8"));
const packageJson = JSON.parse(await fs.readFile(path.join(prototypeRoot, "package.json"), "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(manifest.name === "skillmesh", "plugin name must be skillmesh");
assert(manifest.version.split("+")[0] === packageJson.version, "plugin base version and package version must match");
assert(manifest.mcpServers === "./.mcp.json", "plugin must reference its MCP companion file");
assert(!("apps" in manifest), "the local plugin must not declare .app.json");
assert(!("hooks" in manifest), "the local plugin must not declare hooks");
assert(Array.isArray(manifest.interface.defaultPrompt) && manifest.interface.defaultPrompt.length <= 3, "plugin must expose at most three starter prompts");

const server = mcp.mcpServers?.skillmesh;
assert(server?.command === "node", "plugin MCP command must use Node.js");
assert(server?.cwd === ".", "plugin MCP cwd must stay relative");
assert(server?.args?.[0] === "./run-mcp.mjs", "plugin MCP launcher must stay relative");
assert(!JSON.stringify(mcp).includes(repositoryRoot), "plugin MCP config must not contain absolute repository paths");

const entry = marketplace.plugins?.find((plugin) => plugin.name === "skillmesh");
assert(entry?.source?.path === "./plugins/skillmesh", "marketplace source must point to the repository plugin");
assert(entry?.policy?.installation === "AVAILABLE", "marketplace installation policy must be AVAILABLE");
assert(entry?.policy?.authentication === "ON_INSTALL", "marketplace authentication policy must be ON_INSTALL");
assert(entry?.category === "Developer Tools", "marketplace category must be Developer Tools");
assert(!("products" in entry.policy), "marketplace must not add product restrictions");

await fs.access(path.join(prototypeRoot, "dist", "skillmesh-workbench.html"));
await fs.access(path.join(pluginRoot, "runtime", "mcp-server.mjs"));
await fs.access(path.join(pluginRoot, "runtime", "dist", "skillmesh-workbench.html"));
assert(!await fs.stat(path.join(pluginRoot, "runtime", "server.mjs")).then(() => true, () => false), "plugin must not bundle an HTTP server");
assert(!await fs.stat(path.join(pluginRoot, "runtime", "public")).then(() => true, () => false), "plugin must not bundle standalone Web assets");
console.log("SkillMesh repository plugin contract is valid.");
