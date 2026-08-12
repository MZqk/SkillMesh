import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_SCRIPT_PATH = path.resolve(import.meta.dirname, "../scripts/render-skill-plan-pdf.py");

async function executable(file) {
  if (!file) return false;
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function resolvePdfPython({ explicit = process.env.CAPABILITY_ATLAS_PDF_PYTHON } = {}) {
  const projectPython = path.resolve(import.meta.dirname, "../.venv/bin/python");
  for (const candidate of [explicit, projectPython, "python3"]) {
    if (candidate === "python3" || await executable(candidate)) return candidate;
  }
  return null;
}

export async function renderSkillPlanPdf(plan, {
  python,
  scriptPath = DEFAULT_SCRIPT_PATH,
  timeoutMs = 30_000,
} = {}) {
  const executablePath = python || await resolvePdfPython();
  if (!executablePath) throw new Error("pdf-renderer-unavailable:run-npm-setup-pdf");
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [scriptPath], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("pdf-render-failed:timeout"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`pdf-render-failed:${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`pdf-render-failed:${Buffer.concat(stderr).toString("utf8").trim() || `exit-${code}`}`));
        return;
      }
      resolve(Buffer.concat(stdout));
    });
    child.stdin.end(JSON.stringify(plan));
  });
}
