import { createHash } from "node:crypto";

import { parseSkillDocument } from "./frontmatter.mjs";
import { scanSkillText } from "./security-scan.mjs";

const DEFAULT_SOURCE_URL = "https://zita-go.github.io/Skills-Atlas/data.json";
const MAX_RESPONSE_BYTES = 4_000_000;
const MAX_SKILL_DOCUMENT_BYTES = 256 * 1024;
const MAX_DOCUMENT_CACHE_ENTRIES = 64;
const DOCUMENT_CACHE_TTL_MS = 30 * 60 * 1_000;

function text(value, max = 2_000) {
  return String(value || "").normalize("NFKC").trim().slice(0, max);
}

function normalize(value) {
  return text(value, 20_000).toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function packageBase(source) {
  const value = `${text(source?.author, 200)}/${text(source?.repo, 200)}`;
  return /^[\w.-]+\/[\w.-]+$/u.test(value) ? value : "";
}

function skillDocumentPath(value) {
  const candidate = text(value, 2_000).replace(/^\.\//, "");
  const parts = candidate.split("/");
  if (!candidate
    || candidate.startsWith("/")
    || candidate.includes("\\")
    || parts.some((part) => !part || part === "." || part === "..")
    || !/^skill\.md$/iu.test(parts.at(-1))) return "";
  return parts.join("/");
}

function githubRepository(source) {
  const base = packageBase(source);
  if (!base || !source?.url) return null;
  try {
    const url = new URL(source.url);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") return null;
    const [owner, rawRepo, ...rest] = url.pathname.split("/").filter(Boolean);
    const repo = rawRepo?.replace(/\.git$/iu, "");
    if (rest.length || `${owner}/${repo}`.toLowerCase() !== base.toLowerCase()) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

function webUrl(value) {
  try {
    const url = new URL(text(value, 1_000));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function publicItem(item) {
  const { searchText, searchScore, skillDocs, skillLicenses, ...safe } = item;
  return safe;
}

function candidateForItem(item, {
  skillName,
  stageId,
  capabilityId,
  query = "",
  rationale = "",
} = {}) {
  const normalizedSkillName = text(skillName, 300);
  if (!item.recordable || !item.recordableSkills.includes(normalizedSkillName)) {
    throw new Error("ecosystem-skill-not-recordable");
  }
  const chainPosition = item.skills.indexOf(normalizedSkillName) + 1;
  return {
    stageId: text(stageId, 200),
    capabilityId: text(capabilityId, 200),
    query: text(query, 500),
    packageId: `${item.packageBase}@${normalizedSkillName}`,
    skillName: normalizedSkillName,
    sourceUrl: item.source.url,
    githubStars: item.source.stars,
    license: text(item.skillLicenses?.[normalizedSkillName] || item.source.license, 100),
    publisher: item.source.author || item.source.name,
    catalogItemId: item.id,
    catalogGroupId: item.groupId,
    catalogGroup: item.group,
    chain: item.chain,
    chainPosition: item.chain ? chainPosition : 0,
    chainLength: item.chain ? item.skills.length : 0,
    securityNotes: "来自 Skills Atlas 公开元数据；记录候选不代表已安装或运行。安装前应核对原文、发布者、许可证、脚本、工具声明与静态线索。",
    rationale: text(rationale || `候选用于补齐“${item.group}”相关能力。`, 2_000),
    status: "suggested",
  };
}

function documentTools(value) {
  if (Array.isArray(value)) return value.map((item) => text(item, 100)).filter(Boolean).slice(0, 100);
  return text(value, 2_000).split(/[\s,]+/u).map((item) => item.trim()).filter(Boolean).slice(0, 100);
}

function lineForMetadata(contents, key) {
  const lines = String(contents || "").split(/\r?\n/u);
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`, "iu");
  const index = lines.findIndex((line) => pattern.test(line.trimStart()));
  return index < 0 ? 1 : index + 1;
}

function excerptForLine(contents, line) {
  return String(contents || "").split(/\r?\n/u)[Math.max(0, line - 1)]?.trim().slice(0, 240) || "";
}

function frontmatterFindings(contents, parsed, file) {
  const findings = [];
  for (const diagnostic of parsed.diagnostics || []) {
    findings.push({
      id: diagnostic,
      severity: "low",
      message: diagnostic === "frontmatter-missing"
        ? "未发现 YAML frontmatter，名称、说明和工具声明无法核对。"
        : diagnostic === "name-missing"
          ? "frontmatter 未声明 Skill 名称。"
          : diagnostic === "description-missing"
            ? "frontmatter 未声明用途说明。"
            : "frontmatter 存在无法解析的字段。",
      file,
      line: 1,
      excerpt: excerptForLine(contents, 1),
    });
  }
  const allowedToolsKey = Object.hasOwn(parsed.metadata, "allowed-tools")
    ? "allowed-tools"
    : Object.hasOwn(parsed.metadata, "allowed_tools") ? "allowed_tools" : "";
  const allowedTools = documentTools(allowedToolsKey ? parsed.metadata[allowedToolsKey] : []);
  if (allowedTools.includes("*")) {
    const line = lineForMetadata(contents, allowedToolsKey);
    findings.push({
      id: "unbounded-tool-declaration",
      severity: "high",
      message: "工具声明包含通配符；安装前应确认实际权限边界。",
      file,
      line,
      excerpt: excerptForLine(contents, line),
    });
  } else if (allowedTools.some((tool) => /^(?:bash|shell|terminal)(?:\b|\()/iu.test(tool))) {
    const line = lineForMetadata(contents, allowedToolsKey);
    findings.push({
      id: "shell-tool-declaration",
      severity: "medium",
      message: "工具声明包含 Shell 能力；需结合正文核对命令范围。",
      file,
      line,
      excerpt: excerptForLine(contents, line),
    });
  }
  return { allowedTools, findings };
}

function highestSeverity(findings) {
  const rank = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
  return findings.reduce(
    (highest, finding) => rank[finding.severity] > rank[highest] ? finding.severity : highest,
    "none",
  );
}

async function responseBuffer(response, maxBytes) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("ecosystem-skill-document-too-large");
  }
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error("ecosystem-skill-document-too-large");
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
        throw new Error("ecosystem-skill-document-too-large");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

function numericHeader(response, name) {
  const raw = response.headers?.get?.(name);
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function sourceFor(raw, vendors) {
  const vendor = vendors?.[raw?.name] || {};
  return {
    name: text(raw?.name || vendor.name, 300),
    url: webUrl(raw?.url || vendor.url),
    description: text(vendor.description || raw?.description, 2_000),
    stars: Math.max(0, Number(raw?.stars ?? vendor.stars) || 0),
    lastCommit: text(raw?.last_commit || vendor.last_commit, 100),
    type: text(raw?.type || vendor.type, 100),
    author: text(raw?.author || vendor.author, 200),
    repo: text(raw?.repo || vendor.repo, 200),
    defaultBranch: text(raw?.default_branch || vendor.default_branch, 200) || "main",
    license: text(raw?.license || vendor.license, 100),
    installCommand: text(raw?.install?.command || vendor.install?.command, 1_000),
    docPath: text(raw?.doc_path || vendor.doc_path, 1_000),
    skillDocs: vendor.skill_docs && typeof vendor.skill_docs === "object" ? vendor.skill_docs : {},
    skillLicenses: vendor.skill_licenses && typeof vendor.skill_licenses === "object" ? vendor.skill_licenses : {},
  };
}

export function normalizeEcosystemCatalog(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.sections)) {
    throw new Error("ecosystem-catalog-invalid");
  }
  const items = [];
  for (const [sectionIndex, section] of data.sections.slice(0, 100).entries()) {
    const categoryId = `category-${sectionIndex + 1}`;
    const category = text(section.title, 300);
    const categoryEnglish = text(section.title_en, 300);
    for (const [subsectionIndex, subsection] of (section.subsections || []).slice(0, 200).entries()) {
      for (const [rowIndex, row] of (subsection.rows || []).slice(0, 2_000).entries()) {
        const skills = [...new Set((row.skills || []).map((skill) => text(skill, 300)).filter(Boolean))].slice(0, 100);
        const sources = Array.isArray(row.sources) ? row.sources.slice(0, 100) : [];
        const groupId = `ecosystem-${sectionIndex}-${subsectionIndex}-${rowIndex}`;
        for (const [sourceIndex, rawSource] of sources.entries()) {
          const source = sourceFor(rawSource, data.vendors || {});
          const knownSkills = skills.filter((skill) => Object.hasOwn(source.skillDocs, skill));
          let recordableSkills = knownSkills;
          if (!recordableSkills.length && sources.length === 1) recordableSkills = skills;
          else if (!recordableSkills.length && sources.length === skills.length && skills[sourceIndex]) {
            recordableSkills = [skills[sourceIndex]];
          }
          const base = packageBase(source);
          const supportsSkillsCli = source.installCommand.startsWith(`npx skills add ${base}`);
          const repository = githubRepository(source);
          const previewableSkills = repository
            ? knownSkills.filter((skill) => skillDocumentPath(source.skillDocs[skill]))
            : [];
          const group = text(row.group, 500);
          const groupEnglish = text(row.group_en, 500);
          const description = text(row.description, 4_000);
          const descriptionEnglish = text(row.description_en, 4_000);
          const useCase = text(row.use_case, 1_000);
          const whenToUse = text(row.when_to_use, 1_000);
          const item = {
            id: `${groupId}-${sourceIndex}`,
            groupId,
            sourceCount: sources.length,
            categoryId,
            category,
            categoryEnglish,
            categoryIcon: text(section.icon, 20),
            subsection: text(subsection.title, 500),
            subsectionEnglish: text(subsection.title_en, 500),
            group,
            groupEnglish,
            description,
            descriptionEnglish,
            useCase,
            useCaseEnglish: text(row.use_case_en, 1_000),
            whenToUse,
            whenToUseEnglish: text(row.when_to_use_en, 1_000),
            personas: (row.personas || []).map((persona) => text(persona, 100)).filter(Boolean).slice(0, 20),
            skills,
            recordableSkills,
            previewableSkills,
            chain: row.chain === true,
            source: {
              name: source.name,
              url: source.url,
              description: source.description,
              stars: source.stars,
              lastCommit: source.lastCommit,
              type: source.type,
              author: source.author,
              repo: source.repo,
              defaultBranch: source.defaultBranch,
              license: source.license,
              installCommand: source.installCommand,
              docPath: source.docPath,
            },
            packageBase: base,
            recordable: Boolean(base && supportsSkillsCli && recordableSkills.length),
            skillDocs: source.skillDocs,
            skillLicenses: source.skillLicenses,
          };
          item.searchText = normalize([
            category,
            categoryEnglish,
            item.subsection,
            item.subsectionEnglish,
            group,
            groupEnglish,
            description,
            descriptionEnglish,
            useCase,
            item.useCaseEnglish,
            whenToUse,
            item.whenToUseEnglish,
            skills.join(" "),
            source.name,
            source.author,
            source.repo,
            source.description,
            item.personas.join(" "),
          ].join(" "));
          items.push(item);
        }
      }
    }
  }
  return items;
}

function queryScore(item, terms) {
  if (!terms.length) return 0;
  const skills = item.skills.map(normalize);
  const group = normalize(`${item.group} ${item.groupEnglish}`);
  const source = normalize(`${item.source.name} ${item.source.author}/${item.source.repo}`);
  return terms.reduce((score, term) => {
    if (skills.includes(term)) return score + 12;
    if (skills.some((skill) => skill.startsWith(term))) return score + 8;
    if (group.includes(term)) return score + 5;
    if (source.includes(term)) return score + 3;
    return score + 1;
  }, 0);
}

export class EcosystemCatalogService {
  constructor({
    sourceUrl = DEFAULT_SOURCE_URL,
    fetcher = globalThis.fetch,
    cacheTtlMs = 6 * 60 * 60 * 1_000,
    documentCacheTtlMs = DOCUMENT_CACHE_TTL_MS,
    documentTimeoutMs = 10_000,
    githubToken = "",
  } = {}) {
    this.sourceUrl = sourceUrl;
    this.fetcher = fetcher;
    this.cacheTtlMs = cacheTtlMs;
    this.documentCacheTtlMs = documentCacheTtlMs;
    this.documentTimeoutMs = Math.max(1, Number(documentTimeoutMs) || 10_000);
    this.githubToken = text(githubToken, 1_000);
    this.cached = null;
    this.expiresAt = 0;
    this.inflight = null;
    this.documentCache = new Map();
    this.documentInflight = new Map();
  }

  async load({ refresh = false } = {}) {
    if (!refresh && this.cached && Date.now() < this.expiresAt) return this.cached;
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await this.fetcher(this.sourceUrl, {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!response?.ok) throw new Error(`ecosystem-catalog-upstream:${response?.status || "unknown"}`);
        const raw = await response.text();
        if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new Error("ecosystem-catalog-too-large");
        const items = normalizeEcosystemCatalog(JSON.parse(raw));
        this.cached = {
          items,
          fetchedAt: new Date().toISOString(),
          sourceUrl: this.sourceUrl,
        };
        this.expiresAt = Date.now() + this.cacheTtlMs;
        return this.cached;
      } catch (error) {
        if (this.cached) return this.cached;
        const wrapped = new Error(error.name === "AbortError" ? "ecosystem-catalog-timeout" : error.message);
        wrapped.status = 502;
        throw wrapped;
      } finally {
        clearTimeout(timeout);
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  async search({ query = "", category = "", source = "", chain = "", sort = "relevance", cursor = 0, limit = 100, refresh = false } = {}) {
    const catalog = await this.load({ refresh });
    const terms = normalize(query).split(" ").filter(Boolean).slice(0, 20);
    const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const offset = Math.max(0, Number(cursor) || 0);
    let matches = catalog.items
      .filter((item) => !category || item.categoryId === category)
      .filter((item) => !source || item.source.name === source)
      .filter((item) => chain !== "chained" || item.chain)
      .filter((item) => {
        if (!terms.length) return true;
        const matchedTerms = terms.filter((term) => item.searchText.includes(term)).length;
        const requiredMatches = terms.length <= 2 ? terms.length : terms.length <= 4 ? 2 : 1;
        return matchedTerms >= requiredMatches;
      })
      .map((item) => ({ ...item, searchScore: queryScore(item, terms) }));
    if (sort === "popular") {
      matches.sort((left, right) => right.source.stars - left.source.stars || left.group.localeCompare(right.group));
    } else if (sort === "recent") {
      matches.sort((left, right) => right.source.lastCommit.localeCompare(left.source.lastCommit) || right.source.stars - left.source.stars);
    } else {
      matches.sort((left, right) => right.searchScore - left.searchScore
        || Number(right.chain) - Number(left.chain)
        || right.source.stars - left.source.stars
        || left.group.localeCompare(right.group));
    }
    const categories = [...new Map(catalog.items.map((item) => [item.categoryId, {
      id: item.categoryId,
      label: `${item.categoryIcon} ${item.category}`.trim(),
    }])).values()];
    const sourceCounts = new Map();
    for (const item of catalog.items) sourceCounts.set(item.source.name, (sourceCounts.get(item.source.name) || 0) + 1);
    const sources = [...sourceCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
    return {
      items: matches.slice(offset, offset + boundedLimit).map(publicItem),
      total: matches.length,
      nextCursor: offset + boundedLimit < matches.length ? offset + boundedLimit : null,
      fetchedAt: catalog.fetchedAt,
      sourceUrl: catalog.sourceUrl,
      facets: { categories, sources },
      stats: {
        groups: new Set(catalog.items.map((item) => `${item.categoryId}:${item.subsection}:${item.group}`)).size,
        skills: new Set(catalog.items.flatMap((item) => item.skills)).size,
        sources: sourceCounts.size,
        chained: new Set(catalog.items.filter((item) => item.chain).map((item) => `${item.categoryId}:${item.subsection}:${item.group}`)).size,
      },
      warning: "生态元数据来自公开目录，仅用于发现；尚未安装、执行或完成本地安全审查。",
    };
  }

  async previewForSkill({ itemId, skillName, refresh = false } = {}) {
    const catalog = await this.load();
    const item = catalog.items.find((entry) => entry.id === text(itemId, 200));
    if (!item) throw new Error("ecosystem-item-not-found");
    const normalizedSkillName = text(skillName, 300);
    const documentPath = Object.hasOwn(item.skillDocs || {}, normalizedSkillName)
      ? skillDocumentPath(item.skillDocs[normalizedSkillName])
      : "";
    if (!normalizedSkillName || !documentPath) {
      throw new Error("ecosystem-skill-preview-unavailable");
    }
    const repository = githubRepository(item.source);
    if (!repository) throw new Error("ecosystem-skill-source-unsupported");
    const branch = text(item.source.defaultBranch, 200) || "main";
    const cacheKey = `${repository.owner.toLowerCase()}/${repository.repo.toLowerCase()}:${branch}:${documentPath}`;
    const cached = this.documentCache.get(cacheKey);
    if (!refresh && cached && Date.now() < cached.expiresAt) {
      this.documentCache.delete(cacheKey);
      this.documentCache.set(cacheKey, cached);
      return { ...cached.payload, cached: true };
    }
    if (!refresh && this.documentInflight.has(cacheKey)) return this.documentInflight.get(cacheKey);

    const request = (async () => {
      const encodedPath = documentPath.split("/").map(encodeURIComponent).join("/");
      const apiUrl = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.documentTimeoutMs);
      try {
        const headers = {
          accept: "application/vnd.github.raw+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "skillmesh-skill-review",
        };
        if (this.githubToken) headers.authorization = `Bearer ${this.githubToken}`;
        const response = await this.fetcher(apiUrl, {
          headers,
          redirect: "manual",
          signal: controller.signal,
        });
        if (response.status >= 300 && response.status < 400) {
          throw new Error("ecosystem-skill-document-redirect");
        }
        if (response.status === 404) throw new Error("ecosystem-skill-document-not-found");
        if ([403, 429].includes(response.status)
          && (response.status === 429
            || response.headers?.get?.("x-ratelimit-remaining") === "0"
            || response.headers?.has?.("retry-after"))) {
          const error = new Error("ecosystem-skill-document-rate-limited");
          error.status = 429;
          throw error;
        }
        if (!response.ok) throw new Error(`ecosystem-skill-document-upstream:${response.status || "unknown"}`);
        const buffer = await responseBuffer(response, MAX_SKILL_DOCUMENT_BYTES);
        if (buffer.includes(0)) throw new Error("ecosystem-skill-document-not-text");
        let content;
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        } catch {
          throw new Error("ecosystem-skill-document-not-text");
        }
        const parsed = parseSkillDocument(content, normalizedSkillName);
        const staticScan = scanSkillText(content, { file: documentPath });
        const metadataReview = frontmatterFindings(content, parsed, documentPath);
        const findings = [...staticScan.findings, ...metadataReview.findings]
          .sort((left, right) => left.line - right.line || left.id.localeCompare(right.id));
        const severity = highestSeverity(findings);
        const fetchedAt = new Date().toISOString();
        const htmlPath = documentPath.split("/").map(encodeURIComponent).join("/");
        const htmlBranch = branch.split("/").map(encodeURIComponent).join("/");
        const payload = {
          itemId: item.id,
          skillName: normalizedSkillName,
          cached: false,
          source: {
            catalogName: item.source.name,
            repository: `${repository.owner}/${repository.repo}`,
            branch,
            path: documentPath,
            url: item.source.url,
            documentUrl: `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/blob/${htmlBranch}/${htmlPath}`,
          },
          document: {
            content,
            sha256: createHash("sha256").update(buffer).digest("hex"),
            bytes: buffer.length,
            lines: content ? content.split(/\r?\n/u).length : 0,
            fetchedAt,
          },
          frontmatter: {
            name: text(parsed.name, 300),
            description: text(parsed.description, 2_000),
            allowedTools: metadataReview.allowedTools,
            diagnostics: (parsed.diagnostics || []).map((value) => text(value, 200)).filter(Boolean),
          },
          review: {
            status: ["high", "critical"].includes(severity) ? "attention" : findings.length ? "cues" : "no-cues",
            severity,
            findings,
            scannedAt: staticScan.scannedAt,
          },
          rateLimit: {
            limit: numericHeader(response, "x-ratelimit-limit"),
            remaining: numericHeader(response, "x-ratelimit-remaining"),
            resetAt: numericHeader(response, "x-ratelimit-reset")
              ? new Date(numericHeader(response, "x-ratelimit-reset") * 1_000).toISOString()
              : "",
          },
          warning: "静态规则只提供审阅线索；未命中不代表安全，也不代表已安装、执行或由模型审阅。",
        };
        this.documentCache.delete(cacheKey);
        this.documentCache.set(cacheKey, {
          payload,
          expiresAt: Date.now() + this.documentCacheTtlMs,
        });
        while (this.documentCache.size > MAX_DOCUMENT_CACHE_ENTRIES) {
          this.documentCache.delete(this.documentCache.keys().next().value);
        }
        return payload;
      } catch (error) {
        if (error.name === "AbortError") {
          const timeoutError = new Error("ecosystem-skill-document-timeout");
          timeoutError.status = 504;
          throw timeoutError;
        }
        if (error.message.startsWith("ecosystem-skill-document-upstream:")) error.status = 502;
        else if ([
          "ecosystem-skill-document-redirect",
          "ecosystem-skill-document-not-text",
        ].includes(error.message)) error.status = 502;
        else if (error.message === "ecosystem-skill-document-too-large") error.status = 413;
        throw error;
      } finally {
        clearTimeout(timeout);
        this.documentInflight.delete(cacheKey);
      }
    })();
    this.documentInflight.set(cacheKey, request);
    return request;
  }

  async #reviewedEvidence({ itemId, skillName, reviewedContentHash }) {
    const expectedHash = text(reviewedContentHash, 200).toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(expectedHash)) throw new Error("ecosystem-skill-review-required");
    const preview = await this.previewForSkill({ itemId, skillName });
    if (preview.document.sha256 !== expectedHash) throw new Error("ecosystem-reviewed-content-changed");
    return {
      reviewedContentHash: expectedHash,
      reviewedAt: new Date().toISOString(),
      reviewedRepository: preview.source.repository,
      reviewedBranch: preview.source.branch,
      reviewedPath: preview.source.path,
      reviewedSeverity: preview.review.severity,
    };
  }

  async candidateFor({ itemId, skillName, stageId, capabilityId, query = "", rationale = "", reviewedContentHash = "" }) {
    if (!text(stageId, 200) || !text(capabilityId, 200)) throw new Error("ecosystem-gap-required");
    const catalog = await this.load();
    const item = catalog.items.find((entry) => entry.id === itemId);
    if (!item) throw new Error("ecosystem-item-not-found");
    const candidate = candidateForItem(item, { skillName, stageId, capabilityId, query, rationale });
    const reviewed = await this.#reviewedEvidence({ itemId, skillName, reviewedContentHash });
    return { ...candidate, ...reviewed };
  }

  async candidatesForChain({
    itemId,
    skillNames,
    stageId,
    capabilityId,
    query = "",
    rationale = "",
    reviewedContentHashes = {},
  }) {
    if (!text(stageId, 200) || !text(capabilityId, 200)) throw new Error("ecosystem-gap-required");
    if (!Array.isArray(skillNames) || !skillNames.length || skillNames.length > 100) {
      throw new Error("ecosystem-chain-skills-required");
    }
    const catalog = await this.load();
    const item = catalog.items.find((entry) => entry.id === itemId);
    if (!item) throw new Error("ecosystem-item-not-found");
    if (!item.chain) throw new Error("ecosystem-item-not-chain");
    const requested = new Set(skillNames.map((skillName) => text(skillName, 300)).filter(Boolean));
    if (!requested.size || requested.size !== skillNames.length) {
      throw new Error("ecosystem-chain-skills-required");
    }
    for (const skillName of requested) {
      if (!item.recordableSkills.includes(skillName)) throw new Error("ecosystem-skill-not-recordable");
    }
    const ordered = item.skills
      .filter((skillName) => requested.has(skillName))
      .map((skillName) => candidateForItem(item, {
        skillName,
        stageId,
        capabilityId,
        query,
        rationale: rationale || `“${item.group}”组合链成员 ${skillName}，用于补齐同一能力缺口。`,
      }));
    const candidates = [];
    for (const candidate of ordered) {
      const reviewed = await this.#reviewedEvidence({
        itemId,
        skillName: candidate.skillName,
        reviewedContentHash: reviewedContentHashes?.[candidate.skillName],
      });
      candidates.push({ ...candidate, ...reviewed });
    }
    return candidates;
  }

  async comparisonForGroup(groupId) {
    const catalog = await this.load();
    const normalizedGroupId = text(groupId, 200);
    const items = catalog.items.filter((item) => item.groupId === normalizedGroupId);
    if (!items.length) throw new Error("ecosystem-group-not-found");
    const exemplar = items[0];
    return {
      group: {
        id: exemplar.groupId,
        category: exemplar.category,
        categoryIcon: exemplar.categoryIcon,
        subsection: exemplar.subsection,
        name: exemplar.group,
        description: exemplar.description,
        useCase: exemplar.useCase,
        whenToUse: exemplar.whenToUse,
        skills: exemplar.skills,
        chain: exemplar.chain,
      },
      items: items.map(publicItem),
      fetchedAt: catalog.fetchedAt,
      sourceUrl: catalog.sourceUrl,
      warning: "对比仅陈列公开元数据，不构成质量或安全排名；安装前仍需检查上游内容、脚本与权限。",
    };
  }
}

export { DEFAULT_SOURCE_URL };
