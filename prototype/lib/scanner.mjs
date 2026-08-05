import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { parseSkillDocument } from "./frontmatter.mjs";
import { defaultSkillRoots } from "./roots.mjs";

const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".cache",
  "__pycache__",
]);

// Many Skill packages ship copies for multiple agent clients. Once the package
// itself is already below a configured root, those folders are distribution
// mirrors rather than additional capabilities.
const NESTED_AGENT_MIRRORS = new Set([
  ".agents",
  ".claude",
  ".codex",
  ".cursor",
  ".factory",
  ".gbrain",
  ".hermes",
  ".kiro",
  ".openclaw",
  ".opencode",
  ".slate",
  ".windsurf",
]);

function slug(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (value == null || value === "") return [];
  return String(value)
    .split(/[,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function asBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    if (/^(?:true|yes|on|1)$/i.test(value.trim())) return true;
    if (/^(?:false|no|off|0)$/i.test(value.trim())) return false;
  }
  return fallback;
}

function inferPackageId(root, relativePath, metadata) {
  const declared = metadata.package || metadata.package_id || metadata.plugin || "";
  if (declared) return String(declared).trim();
  if (root.scope !== "plugin-cache") return "";
  const parts = relativePath.split(path.sep).filter(Boolean);
  const skillsIndex = parts.lastIndexOf("skills");
  if (skillsIndex > 0) return parts.slice(0, skillsIndex).join("/");
  return parts.length > 1 ? parts[0] : "";
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readPrefix(filePath, maxBytes) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(Math.max(0, maxBytes));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function discoverSkillFiles(rootPath, { maxDepth, maxFiles }) {
  const discovered = [];
  let truncated = false;

  async function walk(directory, depth, ancestors = new Set()) {
    if (truncated || depth > maxDepth) return;

    let realDirectory;
    try {
      realDirectory = await fs.realpath(directory);
    } catch {
      return;
    }
    // Track only the current branch. A global visited set would hide legitimate
    // logical aliases that point at the same physical Skill directory.
    if (ancestors.has(realDirectory)) return;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(realDirectory);

    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (truncated) break;
      if (depth > 0 && NESTED_AGENT_MIRRORS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".agents") {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
      }
      if (SKIP_DIRECTORIES.has(entry.name)) continue;

      const candidate = path.join(directory, entry.name);
      let kind = entry;
      if (entry.isSymbolicLink()) {
        try {
          const stats = await fs.stat(candidate);
          kind = {
            isDirectory: () => stats.isDirectory(),
            isFile: () => stats.isFile(),
          };
        } catch {
          continue;
        }
      }

      if (kind.isDirectory()) {
        await walk(candidate, depth + 1, nextAncestors);
      } else if (kind.isFile() && entry.name === "SKILL.md") {
        discovered.push(candidate);
        if (discovered.length >= maxFiles) truncated = true;
      }
    }
  }

  await walk(rootPath, 0);
  return { files: discovered, truncated };
}

async function readSkill(filePath, root, { maxBytes }) {
  const fallbackName = path.basename(path.dirname(filePath));
  const stats = await fs.stat(filePath);
  const realPath = await fs.realpath(filePath);
  const diagnostics = [];

  if (stats.size > maxBytes) diagnostics.push("file-too-large");
  const bounded = await readPrefix(filePath, Math.min(stats.size, maxBytes));
  const contents = bounded.toString("utf8");
  const parsed = parseSkillDocument(contents, fallbackName);
  diagnostics.push(...parsed.diagnostics);

  // Large documents are deliberately bounded. Include the original size in
  // the identity and expose a diagnostic rather than loading an arbitrary
  // amount of local data into memory.
  const contentHash = stats.size > maxBytes
    ? hashText(Buffer.concat([bounded, Buffer.from(`\0truncated:${stats.size}`)]))
    : hashText(bounded);
  const name = parsed.name || fallbackName;
  const normalizedName = slug(name) || slug(fallbackName) || contentHash.slice(0, 12);
  const declaredPath = path.resolve(filePath);
  const rootRealPath = await fs.realpath(root.path);
  const expectedRealPath = path.resolve(rootRealPath, path.relative(root.path, declaredPath));
  const metadata = parsed.metadata || {};
  const relativePath = path.relative(root.path, declaredPath);
  const declaredAgents = asStringArray(
    metadata.agents || metadata.agent || metadata["supported-agents"],
  );
  const supportedAgents = declaredAgents.length ? declaredAgents : [...(root.supportedAgents || [root.provider])];
  const disabled = asBoolean(metadata.disable ?? metadata.disabled, false);
  const allowedTools = asStringArray(metadata["allowed-tools"] || metadata.allowed_tools);
  const triggers = asStringArray(metadata.triggers || metadata.trigger);
  const keywords = asStringArray(metadata.keywords || metadata.tags);

  return {
    id: hashText(`${declaredPath}\0${contentHash}`).slice(0, 20),
    logicalName: normalizedName,
    name,
    description: parsed.description,
    provider: root.provider,
    scope: root.scope,
    sourceKind: root.sourceKind,
    rootStability: root.stability,
    rootLabel: root.label,
    rootPath: root.path,
    path: declaredPath,
    relativePath,
    realPath,
    // Ignore aliases in ancestors of the configured root (for example
    // macOS /var -> /private/var) and flag only aliases inside that root.
    isAlias: expectedRealPath !== realPath,
    contentHash,
    bytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    metadataStatus: parsed.description && metadata.name ? "complete" : "incomplete",
    enabled: !disabled,
    disabledReason: disabled ? String(metadata["disable-reason"] || metadata.disabled_reason || "frontmatter") : "",
    supportedAgents,
    compatibilityNotes: String(metadata.compatibility || "").trim(),
    allowedTools,
    triggers,
    keywords,
    packageId: inferPackageId(root, relativePath, metadata),
    diagnostics: [...new Set(diagnostics)],
    version: String(metadata.version || metadata["source-version"] || "").trim(),
    license: String(metadata.license || "").trim(),
    sourceUrl: String(metadata.source || metadata.repository || metadata.homepage || "").trim(),
    searchText: `${name}\n${parsed.description}\n${parsed.body.slice(0, 24_000)}`,
  };
}

function annotateIdentity(skills) {
  const byContent = new Map();
  const byName = new Map();
  const byRealPath = new Map();

  for (const skill of skills) {
    if (!byContent.has(skill.contentHash)) byContent.set(skill.contentHash, []);
    byContent.get(skill.contentHash).push(skill);
    if (!byName.has(skill.logicalName)) byName.set(skill.logicalName, []);
    byName.get(skill.logicalName).push(skill);
    if (!byRealPath.has(skill.realPath)) byRealPath.set(skill.realPath, []);
    byRealPath.get(skill.realPath).push(skill);
  }

  for (const skill of skills) {
    const sameContent = byContent.get(skill.contentHash) || [];
    const sameName = byName.get(skill.logicalName) || [];
    const sameRealPath = byRealPath.get(skill.realPath) || [];
    skill.identity = {
      contentCopies: sameContent.length,
      nameVariants: new Set(sameName.map((item) => item.contentHash)).size,
      physicalAliases: sameRealPath.length,
      duplicateContent: sameContent.length > 1,
      nameConflict: new Set(sameName.map((item) => item.contentHash)).size > 1,
    };
  }

  return {
    uniqueContent: byContent.size,
    duplicateContentGroups: [...byContent.values()].filter((group) => group.length > 1).length,
    nameConflictGroups: [...byName.values()].filter(
      (group) => new Set(group.map((item) => item.contentHash)).size > 1,
    ).length,
    physicalAliasGroups: [...byRealPath.values()].filter((group) => group.length > 1).length,
  };
}

export async function scanSkills({
  roots = defaultSkillRoots(),
  maxDepth = 10,
  maxFilesPerRoot = 2_000,
  maxBytes = 512 * 1024,
} = {}) {
  const skills = [];
  const rootResults = [];

  for (const root of roots) {
    const available = await exists(root.path);
    if (!available) {
      rootResults.push({ ...root, available: false, files: 0, truncated: false, errors: [] });
      continue;
    }

    const { files, truncated } = await discoverSkillFiles(root.path, {
      maxDepth,
      maxFiles: maxFilesPerRoot,
    });
    const errors = [];
    let accepted = 0;
    for (const file of files) {
      try {
        skills.push(await readSkill(file, root, { maxBytes }));
        accepted += 1;
      } catch (error) {
        errors.push({ path: file, message: error.message });
      }
    }
    rootResults.push({ ...root, available: true, files: accepted, truncated, errors });
  }

  skills.sort((left, right) =>
    left.name.localeCompare(right.name) || left.path.localeCompare(right.path),
  );
  const identityStats = annotateIdentity(skills);
  const providerCounts = Object.fromEntries(
    [...new Set(skills.map((skill) => skill.provider))]
      .sort()
      .map((provider) => [provider, skills.filter((skill) => skill.provider === provider).length]),
  );

  return {
    schemaVersion: "0.3",
    generatedAt: new Date().toISOString(),
    readOnly: true,
    roots: rootResults,
    stats: {
      paths: skills.length,
      uniqueContent: identityStats.uniqueContent,
      duplicateContentGroups: identityStats.duplicateContentGroups,
      nameConflictGroups: identityStats.nameConflictGroups,
      physicalAliasGroups: identityStats.physicalAliasGroups,
      incompleteMetadata: skills.filter((skill) => skill.metadataStatus === "incomplete").length,
      enabled: skills.filter((skill) => skill.enabled).length,
      disabled: skills.filter((skill) => !skill.enabled).length,
      derivedPaths: skills.filter((skill) => skill.sourceKind === "derived").length,
      providers: providerCounts,
    },
    skills,
  };
}

export function publicInventory(inventory) {
  return {
    ...inventory,
    skills: inventory.skills.map(({ searchText, ...skill }) => skill),
  };
}
