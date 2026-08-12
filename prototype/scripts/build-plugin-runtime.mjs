import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { build } from "esbuild";

const prototypeRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(prototypeRoot, "..");
const pluginRoot = path.join(repositoryRoot, "plugins", "skillmesh");
const generatedDirectories = ["runtime", "data", "scripts"];

async function materialize(targetRoot) {
  for (const directory of generatedDirectories) {
    await fs.rm(path.join(targetRoot, directory), { recursive: true, force: true });
  }

  const runtimeRoot = path.join(targetRoot, "runtime");
  await fs.mkdir(runtimeRoot, { recursive: true });
  await build({
    entryPoints: {
      "mcp-server": path.join(prototypeRoot, "mcp-server.mjs"),
    },
    bundle: true,
    entryNames: "[name]",
    format: "esm",
    legalComments: "none",
    minify: false,
    outdir: runtimeRoot,
    outExtension: { ".js": ".mjs" },
    platform: "node",
    sourcemap: false,
    target: ["node20"],
  });

  await Promise.all([
    fs.cp(path.join(prototypeRoot, "data"), path.join(targetRoot, "data"), { recursive: true }),
    fs.mkdir(path.join(runtimeRoot, "dist"), { recursive: true }),
    fs.mkdir(path.join(targetRoot, "scripts"), { recursive: true }),
  ]);
  await Promise.all([
    fs.copyFile(
      path.join(prototypeRoot, "dist", "skillmesh-workbench.html"),
      path.join(runtimeRoot, "dist", "skillmesh-workbench.html"),
    ),
    fs.copyFile(
      path.join(prototypeRoot, "scripts", "render-skill-plan-pdf.py"),
      path.join(targetRoot, "scripts", "render-skill-plan-pdf.py"),
    ),
  ]);
}

async function filesBelow(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function digestMap(root) {
  const result = new Map();
  for (const directory of generatedDirectories) {
    for (const relative of await filesBelow(root, directory)) {
      const contents = await fs.readFile(path.join(root, relative));
      result.set(relative, crypto.createHash("sha256").update(contents).digest("hex"));
    }
  }
  return result;
}

async function sameGeneratedFiles(leftRoot, rightRoot) {
  const [left, right] = await Promise.all([digestMap(leftRoot), digestMap(rightRoot)]);
  if (left.size !== right.size) return false;
  return [...left].every(([file, digest]) => right.get(file) === digest);
}

if (process.argv.includes("--check")) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "skillmesh-plugin-build-"));
  try {
    await materialize(temporaryRoot);
    if (!await sameGeneratedFiles(pluginRoot, temporaryRoot)) {
      console.error("SkillMesh plugin runtime is stale. Run npm run build:plugin.");
      process.exitCode = 1;
    } else {
      const digest = crypto.createHash("sha256")
        .update(JSON.stringify([...await digestMap(pluginRoot)]))
        .digest("hex")
        .slice(0, 12);
      console.log(`SkillMesh plugin runtime is current (${digest}).`);
    }
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
} else {
  await materialize(pluginRoot);
  const files = await digestMap(pluginRoot);
  const bytes = (await Promise.all([...files.keys()].map(async (file) =>
    (await fs.stat(path.join(pluginRoot, file))).size))).reduce((sum, size) => sum + size, 0);
  console.log(`Built SkillMesh plugin runtime (${files.size} files, ${bytes} bytes).`);
}
