#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.resolve(import.meta.dirname, "..");
const venvDirectory = path.join(projectDirectory, ".venv");
const venvPython = process.platform === "win32"
  ? path.join(venvDirectory, "Scripts", "python.exe")
  : path.join(venvDirectory, "bin", "python3");

function run(command, args, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectDirectory,
      shell: false,
      stdio: quiet ? "ignore" : "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function commandWorks(command, args) {
  try {
    await run(command, args, { quiet: true });
    return true;
  } catch {
    return false;
  }
}

export async function ensureVirtualEnvironment({
  pythonPath = venvPython,
  access = fs.access,
  create,
} = {}) {
  try {
    await access(pythonPath);
    return false;
  } catch {
    await create();
    return true;
  }
}

async function setupWithUv() {
  await ensureVirtualEnvironment({ create: () => run("uv", ["venv", ".venv"]) });
  await run("uv", ["pip", "install", "--python", venvPython, "-r", "requirements-pdf.txt"]);
}

async function setupWithPython() {
  const python = process.platform === "win32" ? "python" : "python3";
  await ensureVirtualEnvironment({ create: () => run(python, ["-m", "venv", ".venv"]) });
  await run(venvPython, ["-m", "pip", "install", "-r", "requirements-pdf.txt"]);
}

export async function setupPdf() {
  await fs.mkdir(projectDirectory, { recursive: true });
  if (await commandWorks("uv", ["--version"])) await setupWithUv();
  else await setupWithPython();
  await run(venvPython, ["-c", "import reportlab; print('PDF renderer ready: ReportLab ' + reportlab.Version)"]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await setupPdf();
