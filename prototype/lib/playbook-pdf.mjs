import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_SCRIPT_PATH = path.resolve(import.meta.dirname, "../scripts/render-playbook-pdf.py");
const MAX_PDF_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_CHARS = 64 * 1024;

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

export function pdfPythonCandidates({ pythonExecutable, env = process.env } = {}) {
  const projectVenv = process.platform === "win32"
    ? path.resolve(import.meta.dirname, "../.venv/Scripts/python.exe")
    : path.resolve(import.meta.dirname, "../.venv/bin/python3");
  const activeVenv = env.VIRTUAL_ENV
    ? path.join(env.VIRTUAL_ENV, process.platform === "win32" ? "Scripts/python.exe" : "bin/python3")
    : null;
  return unique([
    pythonExecutable,
    env.CAPABILITY_ATLAS_PDF_PYTHON,
    projectVenv,
    activeVenv,
    process.platform === "win32" ? "python" : "python3",
  ]);
}

function boundedDetail(stderr) {
  const line = String(stderr || "").trim().split(/\r?\n/).filter(Boolean).at(-1) || "unknown-error";
  return line.slice(0, 1_000);
}

function runPdfProcess(command, scriptPath, payload, { timeoutMs, env }) {
  return new Promise((resolve) => {
    const child = spawn(command, [scriptPath], {
      cwd: path.dirname(scriptPath),
      env: { ...env, PYTHONUNBUFFERED: "1" },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const chunks = [];
    let size = 0;
    let stderr = "";
    let settled = false;
    let oversized = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ kind: "timeout" });
    }, timeoutMs);
    timer.unref?.();
    child.once("error", (error) => finish({ kind: error.code === "ENOENT" ? "missing" : "failed", detail: error.message }));
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_PDF_BYTES) {
        oversized = true;
        child.kill("SIGTERM");
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-MAX_STDERR_CHARS);
    });
    child.once("close", (code) => {
      if (oversized) return finish({ kind: "failed", detail: "pdf-output-too-large" });
      if (code !== 0) {
        const missingDependency = /No module named ['\"]reportlab['\"]/.test(stderr);
        return finish({ kind: missingDependency ? "missing-dependency" : "failed", detail: boundedDetail(stderr) });
      }
      const pdf = Buffer.concat(chunks);
      if (pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
        return finish({ kind: "failed", detail: "pdf-output-invalid" });
      }
      return finish({ kind: "success", pdf });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

export async function renderPlaybookPdf({ playbook, projectBrief, verification = {} }, {
  pythonExecutable,
  scriptPath = DEFAULT_SCRIPT_PATH,
  timeoutMs = 30_000,
  env = process.env,
  processRunner = runPdfProcess,
} = {}) {
  if (!playbook || !projectBrief) throw new Error("playbook-pdf-source-required");
  await fs.access(scriptPath);
  let lastFailure = null;
  for (const candidate of pdfPythonCandidates({ pythonExecutable, env })) {
    const result = await processRunner(candidate, scriptPath, { playbook, projectBrief, verification }, { timeoutMs, env });
    if (result.kind === "success") return result.pdf;
    if (result.kind === "timeout") throw new Error("pdf-render-timeout");
    if (result.kind === "failed") lastFailure = result.detail;
  }
  if (lastFailure) throw new Error(`pdf-render-failed:${lastFailure}`);
  throw new Error("pdf-renderer-unavailable:run-npm-setup-pdf");
}
