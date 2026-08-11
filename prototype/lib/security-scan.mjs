import fs from "node:fs/promises";
import path from "node:path";

const MAX_FILES = 250;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 512 * 1024;
const SEVERITY_RANK = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

const RULES = [
  {
    id: "pipe-remote-shell",
    severity: "critical",
    pattern: /(?:curl|wget)[^\n|]{0,300}\|\s*(?:ba|z|fi)?sh\b/i,
    message: "检测到远程内容直接传入 Shell。",
  },
  {
    id: "destructive-root-delete",
    severity: "critical",
    pattern: /\brm\s+-[^\n]{0,20}r[^\n]{0,20}f[^\n]{0,80}(?:\/|~|\$HOME)\b/i,
    message: "检测到可能针对宽目录的递归删除命令。",
  },
  {
    id: "credential-access",
    severity: "high",
    pattern: /(?:\.ssh\/|id_rsa|aws\/credentials|keychain|security\s+find-generic-password)/i,
    message: "检测到读取凭据或私钥的指令。",
  },
  {
    id: "shell-execution",
    severity: "medium",
    pattern: /(?:child_process|execSync\s*\(|spawnSync\s*\(|os\.system\s*\(|subprocess\.(?:run|Popen)\s*\()/i,
    message: "包含直接启动系统命令的代码。",
  },
  {
    id: "elevated-command",
    severity: "medium",
    pattern: /(^|\s)sudo\s+/im,
    message: "包含提权命令；SkillMesh 本身不会执行 sudo。",
  },
  {
    id: "dynamic-evaluation",
    severity: "medium",
    pattern: /\b(?:eval|Function)\s*\(/,
    message: "包含动态代码执行。",
  },
];

function findingLocation(contents, index) {
  const line = contents.slice(0, index).split("\n").length;
  const start = contents.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const end = contents.indexOf("\n", index);
  const excerpt = contents.slice(start, end === -1 ? contents.length : end).trim().slice(0, 240);
  return { line, excerpt };
}

function summarizeFindings(findings) {
  const severity = findings.reduce(
    (highest, finding) => SEVERITY_RANK[finding.severity] > SEVERITY_RANK[highest] ? finding.severity : highest,
    "none",
  );
  return {
    status: ["high", "critical"].includes(severity) ? "blocked" : findings.length ? "warning" : "passed",
    severity,
  };
}

export function scanSkillText(contents, { file = "SKILL.md" } = {}) {
  const source = String(contents || "");
  const findings = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    const match = rule.pattern.exec(source);
    if (!match) continue;
    findings.push({
      id: rule.id,
      severity: rule.severity,
      message: rule.message,
      file,
      ...findingLocation(source, match.index),
    });
  }
  return {
    ...summarizeFindings(findings),
    findings,
    bytesScanned: Buffer.byteLength(source),
    linesScanned: source ? source.split(/\r?\n/).length : 0,
    truncated: false,
    scannedAt: new Date().toISOString(),
  };
}

async function filesBelow(rootPath) {
  const result = [];
  async function visit(directory) {
    if (result.length >= MAX_FILES) return;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (result.length >= MAX_FILES) break;
      if ([".git", "node_modules", "dist", "build"].includes(entry.name)) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile()) result.push(candidate);
    }
  }
  const stats = await fs.lstat(rootPath);
  if (stats.isSymbolicLink()) {
    const real = await fs.realpath(rootPath);
    await visit(real);
  } else if (stats.isDirectory()) await visit(rootPath);
  else if (stats.isFile()) result.push(rootPath);
  return result;
}

export async function scanInstalledSkill(rootPath) {
  const findings = [];
  let bytesScanned = 0;
  let truncated = false;
  const files = await filesBelow(rootPath);
  for (const filePath of files) {
    const stats = await fs.stat(filePath).catch(() => null);
    if (!stats || bytesScanned >= MAX_TOTAL_BYTES) {
      truncated = true;
      break;
    }
    const remaining = MAX_TOTAL_BYTES - bytesScanned;
    const bytes = Math.min(stats.size, MAX_FILE_BYTES, remaining);
    if (stats.size > bytes) truncated = true;
    const handle = await fs.open(filePath, "r");
    let contents;
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      contents = buffer.subarray(0, bytesRead).toString("utf8");
      bytesScanned += bytesRead;
    } finally {
      await handle.close();
    }
    findings.push(...scanSkillText(contents, {
      file: path.relative(rootPath, filePath) || path.basename(filePath),
    }).findings);
  }
  const { severity, status } = summarizeFindings(findings);
  return {
    status,
    severity,
    findings,
    filesScanned: files.length,
    bytesScanned,
    truncated,
    scannedAt: new Date().toISOString(),
  };
}
