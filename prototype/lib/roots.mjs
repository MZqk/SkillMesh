import os from "node:os";
import path from "node:path";

function configuredHomeDirectory() {
  return process.env.CAPABILITY_ATLAS_HOME_DIR
    ? path.resolve(process.env.CAPABILITY_ATLAS_HOME_DIR)
    : os.homedir();
}

function rootEntry(rootPath, provider, scope, label, options = {}) {
  return {
    path: path.resolve(rootPath),
    provider,
    scope,
    label,
    stability: options.stability ?? "documented",
    sourceKind: options.sourceKind ?? "direct",
    supportedAgents: options.supportedAgents ?? (provider === "agent-skills" || provider === "extra"
      ? ["*"]
      : [provider]),
  };
}

function expandHome(value, homeDirectory) {
  const trimmed = String(value || "").trim();
  if (trimmed === "~") return homeDirectory;
  if (trimmed.startsWith(`~${path.sep}`)) return path.join(homeDirectory, trimmed.slice(2));
  return trimmed;
}

export function customSkillRoots(values, { homeDirectory = configuredHomeDirectory() } = {}) {
  if (!Array.isArray(values)) throw new Error("custom-roots-must-be-an-array");
  if (values.length > 20) throw new Error("too-many-custom-roots");

  const seen = new Set();
  return values.flatMap((value, index) => {
    const expanded = expandHome(value, homeDirectory);
    if (!expanded) return [];
    const resolved = path.resolve(expanded);
    const filesystemRoot = path.parse(resolved).root;
    if (resolved === filesystemRoot || resolved === path.resolve(homeDirectory)) {
      throw new Error("custom-root-too-broad");
    }
    if (seen.has(resolved)) return [];
    seen.add(resolved);
    return [rootEntry(resolved, "extra", "custom", `自定义目录 ${index + 1}`, {
      stability: "user-configured",
    })];
  });
}

export function defaultSkillRoots({
  homeDirectory = configuredHomeDirectory(),
  projectRoot = process.env.CAPABILITY_ATLAS_PROJECT_ROOT || path.resolve(import.meta.dirname, "../.."),
} = {}) {
  const userRoots = [
    rootEntry(path.join(homeDirectory, ".agents/skills"), "agent-skills", "user", "通用 Agent Skills"),
    rootEntry(path.join(homeDirectory, ".codex/skills"), "codex", "user", "Codex 用户 Skill"),
    rootEntry(path.join(homeDirectory, ".codex/plugins/cache"), "codex", "plugin-cache", "Codex 插件缓存", {
      stability: "observed",
      sourceKind: "derived",
    }),
    rootEntry(path.join(homeDirectory, ".claude/skills"), "claude", "user", "Claude 用户 Skill"),
    rootEntry(path.join(homeDirectory, ".claude/plugins/cache"), "claude", "plugin-cache", "Claude 插件缓存", {
      stability: "documented",
      sourceKind: "derived",
    }),
    rootEntry(path.join(homeDirectory, ".cursor/skills"), "cursor", "user", "Cursor 用户 Skill"),
    rootEntry(path.join(homeDirectory, ".cursor/skills-cursor"), "cursor", "internal", "Cursor 内置 Skill", {
      stability: "observed",
      sourceKind: "derived",
    }),
    rootEntry(path.join(homeDirectory, ".workbuddy/skills"), "workbuddy", "user", "WorkBuddy 用户 Skill", {
      stability: "observed",
    }),
    rootEntry(path.join(homeDirectory, ".workbuddy/plugins/cache"), "workbuddy", "plugin-cache", "WorkBuddy 插件缓存", {
      stability: "observed",
      sourceKind: "derived",
    }),
    rootEntry(path.join(homeDirectory, ".workbuddy/connectors/skills"), "workbuddy", "connector", "WorkBuddy Connector Skill", {
      stability: "observed",
      sourceKind: "derived",
    }),
    rootEntry(path.join(homeDirectory, ".qoderwork/skills"), "qoderwork-global", "user", "QoderWork Global Skill"),
    rootEntry(path.join(homeDirectory, ".qoderworkcn/skills"), "qoderwork-cn", "user", "QoderWork CN Skill", {
      stability: "observed",
    }),
    rootEntry(path.join(homeDirectory, ".qoderworkcn/plugins"), "qoderwork-cn", "plugin-cache", "QoderWork CN Expert Kit", {
      stability: "observed",
      sourceKind: "derived",
    }),
    rootEntry(path.join(homeDirectory, ".hermes/skills"), "hermes", "user", "Hermes Skill"),
    rootEntry(path.join(homeDirectory, ".hermes/pending/skills"), "hermes", "pending", "Hermes 待审批 Skill", {
      sourceKind: "derived",
    }),
    rootEntry(path.join(homeDirectory, ".openclaw/skills"), "openclaw", "user", "OpenClaw 状态目录 Skill"),
  ];

  const projectRoots = [
    rootEntry(path.join(projectRoot, ".agents/skills"), "agent-skills", "project", "项目通用 Skill"),
    rootEntry(path.join(projectRoot, ".codex/skills"), "codex", "project", "项目 Codex Skill"),
    rootEntry(path.join(projectRoot, ".claude/skills"), "claude", "project", "项目 Claude Skill"),
    rootEntry(path.join(projectRoot, ".cursor/skills"), "cursor", "project", "项目 Cursor Skill"),
    rootEntry(path.join(projectRoot, "skills"), "openclaw", "project", "项目 OpenClaw / ClawHub Skill"),
  ];

  if (process.env.OPENCLAW_STATE_DIR) {
    userRoots.push(rootEntry(
      path.join(process.env.OPENCLAW_STATE_DIR, "skills"),
      "openclaw",
      "state-dir",
      "OpenClaw 自定义状态目录 Skill",
      { stability: "environment-configured" },
    ));
  }

  const extraRootValues = (process.env.CAPABILITY_ATLAS_EXTRA_ROOTS || "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  const extraRoots = customSkillRoots(extraRootValues, { homeDirectory });

  return [...userRoots, ...projectRoots, ...extraRoots];
}
