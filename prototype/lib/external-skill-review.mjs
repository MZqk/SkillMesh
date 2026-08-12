import { createHash } from "node:crypto";

import { parseSkillDocument } from "./frontmatter.mjs";
import { scanSkillText } from "./security-scan.mjs";

const MAX_REPOSITORY_BYTES = 128 * 1024;
const MAX_TREE_BYTES = 4 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 256 * 1024;

function boundedText(value, max = 2_000) {
  return String(value || "").normalize("NFKC").trim().slice(0, max);
}

function packageCoordinates(packageId) {
  const match = boundedText(packageId, 500).match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)@([A-Za-z0-9_.-]+)$/u);
  if (!match) throw new Error("external-skill-package-review-unsupported");
  return { owner: match[1], repo: match[2], skill: match[3] };
}

function apiHeaders() {
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "skillmesh-skill-review",
  };
}

async function responseBuffer(response, maxBytes) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("external-skill-review-response-too-large");
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error("external-skill-review-response-too-large");
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      size += chunk.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("external-skill-review-response-too-large");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

async function checkedFetch(fetcher, url, { signal, accept = "application/vnd.github+json", maxBytes }) {
  const response = await fetcher(url, {
    headers: { ...apiHeaders(), accept },
    redirect: "manual",
    signal,
  });
  if (response.status >= 300 && response.status < 400) throw new Error("external-skill-review-redirect");
  if (response.status === 404) throw new Error("external-skill-review-not-found");
  if ([403, 429].includes(response.status)) throw new Error("external-skill-review-rate-limited");
  if (!response.ok) throw new Error(`external-skill-review-upstream:${response.status || "unknown"}`);
  return responseBuffer(response, maxBytes);
}

function decodeUtf8(buffer) {
  if (buffer.includes(0)) throw new Error("external-skill-review-not-text");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("external-skill-review-not-text");
  }
}

async function checkedJson(fetcher, url, { signal, maxBytes }) {
  const buffer = await checkedFetch(fetcher, url, { signal, maxBytes });
  try {
    return JSON.parse(decodeUtf8(buffer));
  } catch (error) {
    if (error.message === "external-skill-review-not-text") throw error;
    throw new Error("external-skill-review-invalid-json");
  }
}

function normalizedSkillName(value) {
  return boundedText(value, 300).toLocaleLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function pathRank(filePath, skillName) {
  const path = boundedText(filePath, 2_000).replace(/^\/+|\/+$/gu, "");
  const parts = path.split("/");
  if (!/^skill\.md$/iu.test(parts.at(-1) || "")) return -1;
  const parent = parts.at(-2) || "";
  if (normalizedSkillName(parent) !== normalizedSkillName(skillName)) return -1;
  const prefix = parts.slice(0, -2).join("/").toLocaleLowerCase();
  const preferred = ["skills", ".agents/skills", ".claude/skills", ".codex/skills", ".cursor/skills", ".github/skills", ".windsurf/skills", ".gemini/skills", ".opencode/skills"];
  const index = preferred.indexOf(prefix);
  return index < 0 ? 100 + parts.length : index;
}

function selectSkillPath(tree, skillName) {
  if (!tree || tree.truncated || !Array.isArray(tree.tree)) throw new Error("external-skill-review-tree-incomplete");
  const documents = tree.tree
    .filter((item) => item?.type === "blob" && /^skill\.md$/iu.test(String(item.path || "").split("/").at(-1) || ""))
    .map((item) => ({ path: boundedText(item.path, 2_000), rank: pathRank(item.path, skillName), size: Number(item.size) || 0 }))
    .filter((item) => item.path && item.rank >= 0 && item.size <= MAX_DOCUMENT_BYTES)
    .sort((left, right) => left.rank - right.rank || left.path.length - right.path.length || left.path.localeCompare(right.path));
  if (!documents.length) {
    const allDocuments = tree.tree.filter((item) => item?.type === "blob" && /^skill\.md$/iu.test(String(item.path || "").split("/").at(-1) || ""));
    if (allDocuments.length === 1 && Number(allDocuments[0].size || 0) <= MAX_DOCUMENT_BYTES) return boundedText(allDocuments[0].path, 2_000);
    throw new Error("external-skill-review-document-not-found");
  }
  return documents[0].path;
}

function allowedTools(metadata) {
  const value = metadata?.["allowed-tools"] ?? metadata?.allowed_tools ?? [];
  if (Array.isArray(value)) return value.map((item) => boundedText(item, 100)).filter(Boolean).slice(0, 100);
  return boundedText(value, 2_000).split(/[\s,]+/u).map((item) => item.trim()).filter(Boolean).slice(0, 100);
}

export class ExternalSkillReviewService {
  constructor({ fetcher = globalThis.fetch, timeoutMs = 12_000 } = {}) {
    if (typeof fetcher !== "function") throw new Error("external-skill-review-fetcher-required");
    this.fetcher = fetcher;
    this.timeoutMs = Math.max(1_000, Math.min(60_000, Number(timeoutMs) || 12_000));
  }

  async preview(candidate) {
    const coordinates = packageCoordinates(candidate?.packageId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const repositoryUrl = `https://api.github.com/repos/${encodeURIComponent(coordinates.owner)}/${encodeURIComponent(coordinates.repo)}`;
      const repository = await checkedJson(this.fetcher, repositoryUrl, {
        signal: controller.signal,
        maxBytes: MAX_REPOSITORY_BYTES,
      });
      const fullName = boundedText(repository?.full_name, 500);
      if (fullName.toLocaleLowerCase() !== `${coordinates.owner}/${coordinates.repo}`.toLocaleLowerCase()) {
        throw new Error("external-skill-review-repository-mismatch");
      }
      const branch = boundedText(repository?.default_branch, 200);
      if (!branch) throw new Error("external-skill-review-branch-missing");
      const treeUrl = `${repositoryUrl}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
      const tree = await checkedJson(this.fetcher, treeUrl, {
        signal: controller.signal,
        maxBytes: MAX_TREE_BYTES,
      });
      const documentPath = selectSkillPath(tree, coordinates.skill);
      const encodedPath = documentPath.split("/").map(encodeURIComponent).join("/");
      const contentUrl = `${repositoryUrl}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
      const buffer = await checkedFetch(this.fetcher, contentUrl, {
        signal: controller.signal,
        accept: "application/vnd.github.raw+json",
        maxBytes: MAX_DOCUMENT_BYTES,
      });
      const content = decodeUtf8(buffer);
      const parsed = parseSkillDocument(content, coordinates.skill);
      if (parsed.metadata?.name
        && normalizedSkillName(parsed.name) !== normalizedSkillName(coordinates.skill)) {
        throw new Error("external-skill-review-name-mismatch");
      }
      const scan = scanSkillText(content, { file: documentPath });
      const fetchedAt = new Date().toISOString();
      return {
        candidateId: boundedText(candidate?.id, 200),
        packageId: boundedText(candidate?.packageId, 500),
        skillName: coordinates.skill,
        source: {
          repository: fullName,
          branch,
          path: documentPath,
          documentUrl: `https://github.com/${encodeURIComponent(coordinates.owner)}/${encodeURIComponent(coordinates.repo)}/blob/${branch.split("/").map(encodeURIComponent).join("/")}/${encodedPath}`,
        },
        document: {
          content,
          sha256: createHash("sha256").update(buffer).digest("hex"),
          bytes: buffer.length,
          lines: content ? content.split(/\r?\n/u).length : 0,
          fetchedAt,
        },
        frontmatter: {
          name: boundedText(parsed.name, 300),
          description: boundedText(parsed.description, 2_000),
          allowedTools: allowedTools(parsed.metadata),
          diagnostics: (parsed.diagnostics || []).map((item) => boundedText(item, 200)).filter(Boolean),
        },
        review: scan,
        warning: "静态规则只提供审阅线索；接受前仍需人工阅读完整原文。未命中不代表安全。",
      };
    } catch (error) {
      if (error.name === "AbortError") throw new Error("external-skill-review-timeout");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
