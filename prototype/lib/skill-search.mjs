import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export function stripAnsi(value) {
  return String(value || "").replace(ANSI_PATTERN, "");
}

function parseCompactNumber(value) {
  const normalized = String(value || "").replaceAll(",", "").trim().toUpperCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)([KMB])?$/);
  if (!match) return 0;
  const multiplier = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[match[2]] || 1;
  return Math.round(Number(match[1]) * multiplier);
}

export function parseSkillSearchOutput(output, { query = "" } = {}) {
  const lines = stripAnsi(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidates = [];
  const seen = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const packageMatch = line.match(/(?:^|\s)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+)(?:\s|$)/);
    if (!packageMatch || seen.has(packageMatch[1])) continue;
    const packageId = packageMatch[1];
    seen.add(packageId);
    const nearby = lines.slice(index, index + 4).join(" ");
    const installs = nearby.match(/([\d,.]+\s*[KMB]?)\s+installs?/i);
    const sourceUrl = nearby.match(/https?:\/\/[^\s)]+/)?.[0] || "";
    candidates.push({
      packageId,
      skillName: packageId.split("@").at(-1),
      sourceUrl,
      installCount: installs ? parseCompactNumber(installs[1].replace(/\s/g, "")) : 0,
      query,
      securityNotes: "外部候选尚未进行本地代码审查；安装前应检查发布者、许可证、脚本与权限声明。",
    });
  }
  return candidates;
}

export async function findExternalSkills(query, {
  limit = 10,
  timeoutMs = 30_000,
  runner = execFile,
} = {}) {
  const boundedQuery = String(query || "").normalize("NFKC").trim().slice(0, 200);
  if (!boundedQuery) throw new Error("external-skill-query-required");
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  try {
    const { stdout = "", stderr = "" } = await runner(
      executable,
      ["-y", "skills", "find", boundedQuery],
      {
        timeout: Math.max(1_000, Math.min(60_000, Number(timeoutMs) || 30_000)),
        maxBuffer: 256 * 1024,
        windowsHide: true,
        env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      },
    );
    return {
      query: boundedQuery,
      command: "npx -y skills find <query>",
      source: "skills-cli",
      searchedAt: new Date().toISOString(),
      candidates: parseSkillSearchOutput(`${stdout}\n${stderr}`, { query: boundedQuery }).slice(0, Math.max(1, Math.min(25, Number(limit) || 10))),
      installPerformed: false,
      warning: "候选来自外部索引，未安装、未执行、未通过安全或许可证审查。",
    };
  } catch (error) {
    const detail = stripAnsi(error.stderr || error.stdout || error.message).slice(0, 2_000);
    throw new Error(`external-skill-search-failed:${detail}`);
  }
}
