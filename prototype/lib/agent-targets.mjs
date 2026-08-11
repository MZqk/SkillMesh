import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TARGETS = [
  {
    id: "codex",
    label: "Codex",
    directory: [".codex", "skills"],
    aliases: ["codex"],
    skillsCliAgent: "codex",
  },
  {
    id: "claude",
    label: "Claude Code",
    directory: [".claude", "skills"],
    aliases: ["claude", "claude-code"],
    skillsCliAgent: "claude-code",
  },
  {
    id: "cursor",
    label: "Cursor",
    directory: [".cursor", "skills"],
    aliases: ["cursor"],
    skillsCliAgent: "cursor",
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    directory: [".gemini", "skills"],
    aliases: ["gemini", "gemini-cli"],
    skillsCliAgent: "gemini-cli",
  },
  {
    id: "antigravity",
    label: "Antigravity",
    directory: [".gemini", "antigravity", "skills"],
    aliases: ["antigravity"],
    skillsCliAgent: "antigravity",
  },
  {
    id: "antigravity-cli",
    label: "Antigravity CLI",
    directory: [".gemini", "antigravity-cli", "skills"],
    aliases: ["antigravity-cli"],
    skillsCliAgent: "antigravity-cli",
  },
  {
    id: "kiro",
    label: "Kiro CLI",
    directory: [".kiro", "skills"],
    aliases: ["kiro", "kiro-cli"],
    skillsCliAgent: "kiro-cli",
  },
  {
    id: "trae",
    label: "Trae",
    directory: [".trae", "skills"],
    aliases: ["trae"],
    skillsCliAgent: "trae",
  },
  {
    id: "opencode",
    label: "OpenCode",
    directory: [".config", "opencode", "skills"],
    aliases: ["opencode"],
    skillsCliAgent: "opencode",
  },
  {
    id: "workbuddy",
    label: "WorkBuddy",
    directory: [".workbuddy", "skills"],
    aliases: ["workbuddy"],
    skillsCliAgent: null,
  },
  {
    id: "qoderwork",
    label: "QoderWork",
    directory: [".qoderwork", "skills"],
    aliases: ["qoderwork", "qoderwork-global"],
    skillsCliAgent: null,
  },
  {
    id: "qoderwork-cn",
    label: "QoderWork CN",
    directory: [".qoderworkcn", "skills"],
    aliases: ["qoderwork-cn"],
    skillsCliAgent: null,
  },
  {
    id: "hermes",
    label: "Hermes",
    directory: [".hermes", "skills"],
    aliases: ["hermes"],
    skillsCliAgent: null,
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    directory: [".openclaw", "skills"],
    aliases: ["openclaw"],
    skillsCliAgent: null,
  },
];

export const AGENT_TARGET_IDS = Object.freeze(TARGETS.map((target) => target.id));

function configuredHomeDirectory() {
  return process.env.CAPABILITY_ATLAS_HOME_DIR
    ? path.resolve(process.env.CAPABILITY_ATLAS_HOME_DIR)
    : os.homedir();
}

function normalized(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function sharedSkillRoot(homeDirectory = configuredHomeDirectory()) {
  return path.join(path.resolve(homeDirectory), ".agents", "skills");
}

export function resolveAgentTarget(id, { homeDirectory = configuredHomeDirectory() } = {}) {
  const value = normalized(id);
  const target = TARGETS.find((item) => item.id === value || item.aliases.includes(value));
  if (!target) throw new Error(`unknown-install-target:${String(id || "")}`);
  return {
    ...target,
    path: path.join(path.resolve(homeDirectory), ...target.directory),
    externalInstallSupported: Boolean(target.skillsCliAgent),
  };
}

export function resolveAgentTargets(ids, options) {
  if (!Array.isArray(ids) || !ids.length) throw new Error("install-targets-required");
  const unique = [...new Set(ids.map((id) => resolveAgentTarget(id, options).id))];
  return unique.map((id) => resolveAgentTarget(id, options));
}

export async function listAgentTargets({ homeDirectory = configuredHomeDirectory() } = {}) {
  const home = path.resolve(homeDirectory);
  return Promise.all(TARGETS.map(async (target) => {
    const targetPath = path.join(home, ...target.directory);
    const applicationDirectory = path.dirname(targetPath);
    return {
      id: target.id,
      label: target.label,
      path: targetPath,
      detected: await exists(applicationDirectory),
      externalInstallSupported: Boolean(target.skillsCliAgent),
    };
  }));
}

export function skillSupportsTarget(supportedAgents, targetId) {
  const declared = (supportedAgents || []).map(normalized);
  if (!declared.length || declared.includes("*")) return true;
  const target = resolveAgentTarget(targetId);
  return target.aliases.some((alias) => declared.includes(alias));
}

export function safeSkillDirectoryName(value, fallback = "skill") {
  const name = String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 120);
  return name || fallback;
}
