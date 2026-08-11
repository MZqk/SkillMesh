import { createHash } from "node:crypto";

export const SKILL_KIT_SCHEMA = "capability-atlas.skill-kit/v1";

const MAX_SKILLS = 100;
const PACKAGE_ID_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$/u;

function text(value, maximum = 2_000) {
  return String(value || "").normalize("NFKC").trim().slice(0, maximum);
}

function normalizedName(value) {
  return text(value, 300).toLocaleLowerCase().replace(/\s+/gu, " ");
}

function stringList(value, { maximum = 20, itemMaximum = 200 } = {}) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, itemMaximum)).filter(Boolean))].slice(0, maximum);
}

function safeSourceUrl(value) {
  const candidate = text(value, 1_000);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function normalizeCapabilityRefs(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const stageId = text(item.stageId, 200);
    const capabilityId = text(item.capabilityId, 200);
    const label = text(item.label, 300);
    if (!stageId || !capabilityId || !label) return [];
    return [{
      stageId,
      capabilityId,
      label,
      required: item.required !== false,
      strength: text(item.strength, 100),
    }];
  });
}

function normalizeCatalogProvenance(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const itemId = text(value.itemId, 200);
  const groupId = text(value.groupId, 200);
  const group = text(value.group, 500);
  const chain = value.chain === true;
  const chainPosition = chain ? Math.max(0, Math.floor(Number(value.chainPosition) || 0)) : 0;
  const chainLength = chain ? Math.max(0, Math.floor(Number(value.chainLength) || 0)) : 0;
  if (!itemId && !groupId && !group && !chain) return null;
  return { itemId, groupId, group, chain, chainPosition, chainLength };
}

function normalizeSkill(value, order) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("skill-kit-skill-invalid");
  const type = ["local-sync", "external-install"].includes(value.type) ? value.type : "";
  const name = text(value.name, 300);
  const contentHash = text(value.contentHash, 200);
  const packageId = text(value.packageId, 500);
  if (!type || !name) throw new Error("skill-kit-skill-invalid");
  if (type === "local-sync" && !contentHash) throw new Error("skill-kit-skill-invalid");
  if (type === "external-install" && !PACKAGE_ID_PATTERN.test(packageId)) {
    throw new Error("skill-kit-external-package-invalid");
  }
  return {
    order,
    name,
    type,
    contentHash,
    packageId,
    sourceUrl: safeSourceUrl(value.sourceUrl),
    version: text(value.version, 100),
    capabilityRefs: normalizeCapabilityRefs(value.capabilityRefs),
    catalog: normalizeCatalogProvenance(value.catalog),
  };
}

function intentFor(manifest) {
  return {
    schema: SKILL_KIT_SCHEMA,
    kind: "skill-kit",
    workflow: manifest.workflow,
    targetAgents: manifest.targetAgents,
    coverage: manifest.coverage,
    skills: manifest.skills,
  };
}

function intentHash(manifest) {
  return createHash("sha256").update(JSON.stringify(intentFor(manifest))).digest("hex");
}

export function normalizeSkillKit(value, { verifyHash = true } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("skill-kit-object-required");
  if (value.schema !== SKILL_KIT_SCHEMA || value.kind !== "skill-kit") {
    throw new Error("skill-kit-schema-unsupported");
  }
  if (!Array.isArray(value.skills) || !value.skills.length || value.skills.length > MAX_SKILLS) {
    throw new Error("skill-kit-skills-required");
  }
  const workflow = value.workflow && typeof value.workflow === "object" && !Array.isArray(value.workflow)
    ? value.workflow
    : {};
  const coverage = value.coverage && typeof value.coverage === "object" && !Array.isArray(value.coverage)
    ? value.coverage
    : {};
  const normalized = {
    schema: SKILL_KIT_SCHEMA,
    kind: "skill-kit",
    workflow: {
      referenceId: text(workflow.referenceId, 200),
      goal: text(workflow.goal, 1_000),
      scope: workflow.scope === "project" ? "project" : "global",
      projectId: workflow.scope === "project" ? text(workflow.projectId, 200) : "",
      revision: Math.max(1, Math.floor(Number(workflow.revision) || 1)),
    },
    targetAgents: stringList(value.targetAgents, { maximum: 20, itemMaximum: 100 }),
    coverage: {
      required: Math.max(0, Math.floor(Number(coverage.required) || 0)),
      covered: Math.max(0, Math.floor(Number(coverage.covered) || 0)),
      uncovered: stringList(coverage.uncovered, { maximum: 200, itemMaximum: 300 }),
    },
    skills: value.skills.map((skill, index) => normalizeSkill(skill, index + 1)),
  };
  const identities = new Set();
  for (const skill of normalized.skills) {
    const identity = skill.type === "local-sync"
      ? `local:${skill.contentHash}`
      : `external:${skill.packageId.toLocaleLowerCase()}`;
    if (identities.has(identity)) throw new Error("skill-kit-duplicate-skill");
    identities.add(identity);
  }
  const calculatedHash = intentHash(normalized);
  const declaredHash = text(value.intentHash, 200);
  if (verifyHash && !declaredHash) throw new Error("skill-kit-hash-required");
  if (verifyHash && declaredHash && declaredHash !== calculatedHash) throw new Error("skill-kit-hash-mismatch");
  return {
    ...normalized,
    intentHash: calculatedHash,
    boundaries: {
      comparisonOnlyOnImport: true,
      installationRequiresHumanApproval: true,
      undeclaredLocalSkills: "leave-untouched",
    },
  };
}

export function buildSkillKit({ workflow, plan }) {
  if (!workflow || typeof workflow !== "object" || !plan || typeof plan !== "object") {
    throw new Error("skill-kit-plan-not-found");
  }
  const selectedItems = (plan.items || []).filter((item) => item.selected === true);
  if (!selectedItems.length) throw new Error("skill-kit-empty");
  const candidates = new Map((workflow.externalCandidates || []).map((candidate) => [candidate.id, candidate]));
  const skills = selectedItems.map((item, index) => {
    const candidate = item.externalCandidateId ? candidates.get(item.externalCandidateId) : null;
    return {
      order: index + 1,
      name: item.name,
      type: item.type,
      contentHash: item.installedContentHash || item.contentHash || item.reviewedContentHash || "",
      packageId: item.packageId || candidate?.packageId || "",
      sourceUrl: item.sourceUrl || candidate?.sourceUrl || "",
      version: item.version || "",
      capabilityRefs: item.capabilityRefs || [],
      catalog: candidate ? {
        itemId: candidate.catalogItemId,
        groupId: candidate.catalogGroupId,
        group: candidate.catalogGroup,
        chain: candidate.chain === true,
        chainPosition: candidate.chainPosition,
        chainLength: candidate.chainLength,
      } : null,
    };
  });
  const kit = normalizeSkillKit({
    schema: SKILL_KIT_SCHEMA,
    kind: "skill-kit",
    workflow: {
      referenceId: workflow.id,
      goal: workflow.goal,
      scope: workflow.scope,
      projectId: workflow.projectId,
      revision: plan.basedOnRevision || workflow.revision,
    },
    targetAgents: plan.targetAgents || [],
    coverage: {
      required: plan.coverage?.required || 0,
      covered: plan.coverage?.covered || 0,
      uncovered: (plan.coverage?.uncovered || []).map((item) => item.label).filter(Boolean),
    },
    skills,
  }, { verifyHash: false });
  return kit;
}

export function reconcileSkillKit({ kit, inventory, workflow }) {
  const manifest = normalizeSkillKit(kit);
  const installed = Array.isArray(inventory?.skills) ? inventory.skills : [];
  const byName = new Map();
  for (const skill of installed) {
    const key = normalizedName(skill.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(skill);
  }
  const workflowCandidates = Array.isArray(workflow?.externalCandidates) ? workflow.externalCandidates : [];
  const items = manifest.skills.map((declared) => {
    const matches = byName.get(normalizedName(declared.name)) || [];
    const active = matches.filter((skill) => skill.enabled !== false);
    const disabledOnly = matches.length > 0 && active.length === 0;
    const exact = declared.contentHash
      ? active.find((skill) => text(skill.contentHash, 200) === declared.contentHash)
      : null;
    const recorded = declared.packageId
      ? workflowCandidates.find((candidate) => candidate.packageId === declared.packageId && candidate.status !== "rejected")
      : null;
    let action = "missing";
    if (exact) action = "up-to-date";
    else if (active.length && declared.contentHash) action = "local-changes";
    else if (active.length) action = "present-unverified";
    else if (disabledOnly) action = "disabled";
    else if (recorded) action = "recorded";
    return {
      order: declared.order,
      name: declared.name,
      type: declared.type,
      packageId: declared.packageId,
      expectedContentHash: declared.contentHash,
      catalog: declared.catalog,
      action,
      candidateStatus: recorded?.status || "",
      observed: {
        copies: matches.length,
        providers: [...new Set(matches.map((skill) => text(skill.provider, 100)).filter(Boolean))],
        contentHashes: [...new Set(matches.map((skill) => text(skill.contentHash, 200)).filter(Boolean))].slice(0, 10),
      },
    };
  });
  const count = (action) => items.filter((item) => action.includes(item.action)).length;
  const declaredNames = new Set(manifest.skills.map((skill) => normalizedName(skill.name)));
  const undeclaredLocal = new Set(installed
    .filter((skill) => skill.enabled !== false && !declaredNames.has(normalizedName(skill.name)))
    .map((skill) => normalizedName(skill.name))
    .filter(Boolean)).size;
  return {
    manifest,
    summary: {
      total: items.length,
      ready: count(["up-to-date"]),
      attention: count(["local-changes", "present-unverified", "disabled"]),
      recorded: count(["recorded"]),
      missing: count(["missing"]),
      undeclaredLocal,
    },
    items,
    workflowMatch: manifest.workflow.referenceId === workflow?.id ? "same-workflow" : "portable-intent",
    effects: {
      writePerformed: false,
      candidatesCreated: 0,
      installationPlansCreated: 0,
      localSkillsRemoved: 0,
    },
  };
}
