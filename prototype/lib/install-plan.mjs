import crypto from "node:crypto";

import {
  resolveAgentTargets,
  safeSkillDirectoryName,
  sharedSkillRoot,
  skillSupportsTarget,
} from "./agent-targets.mjs";

function itemId(type, identity) {
  return `${type}-${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
}

function capabilityKey(stageId, capabilityId) {
  return `${stageId}:${capabilityId}`;
}

function externalName(candidate) {
  if (candidate.skillName) return candidate.skillName;
  const packageId = String(candidate.packageId || "");
  const at = packageId.lastIndexOf("@");
  if (at > packageId.indexOf("/")) return packageId.slice(at + 1);
  return packageId.split("/").filter(Boolean).at(-1) || "external-skill";
}

function mergeCapability(item, capability) {
  if (!item.capabilityRefs.some((entry) => entry.key === capability.key)) item.capabilityRefs.push(capability);
}

function localItems(assessment, targets, homeDirectory) {
  const byHash = new Map();
  for (const stage of assessment.stages || []) {
    const capabilities = new Map((stage.capabilityCoverage || []).map((capability) => [capability.id, capability]));
    for (const candidate of stage.candidates || []) {
      if (candidate.decision !== "confirmed") continue;
      const hash = candidate.contentHash;
      if (!hash) continue;
      const installName = safeSkillDirectoryName(candidate.name, `skill-${hash.slice(0, 8)}`);
      const existing = byHash.get(hash) || {
        id: itemId("local", hash),
        type: "local-sync",
        name: candidate.name,
        installName,
        sourcePath: candidate.realPath || candidate.path || "",
        contentHash: hash,
        packageId: candidate.packageId || "",
        version: candidate.version || "",
        sourceKind: candidate.sourceKind || "direct",
        supportedAgents: candidate.supportedAgents || [],
        targetAgents: targets.map((target) => target.id),
        canonicalPath: `${sharedSkillRoot(homeDirectory)}/${installName}`,
        targetPaths: Object.fromEntries(targets.map((target) => [target.id, `${target.path}/${installName}`])),
        installMode: "managed-symlink",
        capabilityRefs: [],
        score: candidate.score || 0,
        eligible: true,
        selected: false,
        status: "planned",
        riskFlags: candidate.sourceKind === "derived" ? ["derived-source"] : [],
        incompatibleAgents: [],
        conflict: { status: "unchecked", resolution: "keep", renameTo: "" },
        acknowledgements: [],
      };
      for (const score of candidate.capabilityScores || []) {
        const capability = capabilities.get(score.capabilityId);
        if (!capability || score.strength === "none") continue;
        mergeCapability(existing, {
          key: capabilityKey(stage.id, capability.id),
          stageId: stage.id,
          capabilityId: capability.id,
          label: capability.label,
          required: capability.required !== false,
          strength: score.strength,
        });
      }
      byHash.set(hash, existing);
    }
  }

  for (const item of byHash.values()) {
    item.incompatibleAgents = targets
      .filter((target) => !skillSupportsTarget(item.supportedAgents, target.id))
      .map((target) => target.id);
    if (item.incompatibleAgents.length) {
      item.riskFlags.push("compatibility-override-required");
      item.eligible = false;
    }
  }
  return [...byHash.values()];
}

function externalItems(workflow, targets, homeDirectory) {
  const capabilities = new Map();
  for (const stage of workflow.stages || []) {
    for (const capability of stage.capabilities || []) {
      capabilities.set(capabilityKey(stage.id, capability.id), {
        key: capabilityKey(stage.id, capability.id),
        stageId: stage.id,
        capabilityId: capability.id,
        label: capability.label,
        required: capability.required !== false,
        strength: "external",
      });
    }
  }
  return (workflow.externalCandidates || [])
    .filter((candidate) => ["accepted", "installed"].includes(candidate.status) && candidate.stageId && candidate.capabilityId)
    .flatMap((candidate) => {
      const capability = capabilities.get(capabilityKey(candidate.stageId, candidate.capabilityId));
      if (!capability) return [];
      const name = externalName(candidate);
      const installName = safeSkillDirectoryName(name, `external-${candidate.id.slice(0, 8)}`);
      const unsupportedAgents = targets.filter((target) => !target.externalInstallSupported).map((target) => target.id);
      const reviewedContentHash = String(candidate.reviewedContentHash || "").toLowerCase();
      const hasReviewedContent = /^[a-f0-9]{64}$/u.test(reviewedContentHash);
      const reviewedHighRisk = ["high", "critical"].includes(candidate.reviewedSeverity);
      return [{
        id: itemId("external", candidate.id),
        externalCandidateId: candidate.id,
        externalCandidateStatus: candidate.status,
        type: "external-install",
        name,
        installName,
        sourcePath: "",
        contentHash: "",
        reviewedContentHash,
        reviewedAt: candidate.reviewedAt || "",
        reviewedRepository: candidate.reviewedRepository || "",
        reviewedBranch: candidate.reviewedBranch || "",
        reviewedPath: candidate.reviewedPath || "",
        reviewedSeverity: candidate.reviewedSeverity || "none",
        packageId: candidate.packageId,
        sourceUrl: candidate.sourceUrl,
        version: hasReviewedContent ? `reviewed-sha256:${reviewedContentHash.slice(0, 16)}` : "unreviewed",
        sourceKind: "external",
        supportedAgents: targets.filter((target) => target.externalInstallSupported).map((target) => target.id),
        targetAgents: targets.map((target) => target.id),
        canonicalPath: `${sharedSkillRoot(homeDirectory)}/${installName}`,
        targetPaths: Object.fromEntries(targets.map((target) => [target.id, `${target.path}/${installName}`])),
        installMode: "skills-cli",
        capabilityRefs: [capability],
        score: 0,
        eligible: unsupportedAgents.length === 0 && hasReviewedContent && !reviewedHighRisk,
        selected: false,
        status: "planned",
        riskFlags: [
          "pre-scan-visible",
          ...(!hasReviewedContent ? ["reviewed-content-missing"] : []),
          ...(reviewedHighRisk ? ["reviewed-content-high-risk"] : []),
          ...(unsupportedAgents.length ? ["external-target-unsupported"] : []),
        ],
        incompatibleAgents: unsupportedAgents,
        conflict: { status: "unchecked", resolution: "keep", renameTo: "" },
        acknowledgements: [],
        reinstallLatest: false,
      }];
    });
}

function chooseMinimalSet(items, requiredKeys) {
  const uncovered = new Set(requiredKeys);
  while (uncovered.size) {
    const ranked = items
      .filter((item) => item.eligible && !item.selected)
      .map((item) => ({
        item,
        newCoverage: item.capabilityRefs.filter((capability) => capability.required && uncovered.has(capability.key)).length,
      }))
      .filter((entry) => entry.newCoverage > 0)
      .sort((left, right) => right.newCoverage - left.newCoverage
        || Number(right.item.type === "local-sync") - Number(left.item.type === "local-sync")
        || right.item.score - left.item.score
        || left.item.name.localeCompare(right.item.name));
    if (!ranked.length) break;
    ranked[0].item.selected = true;
    for (const capability of ranked[0].item.capabilityRefs) uncovered.delete(capability.key);
  }
  return uncovered;
}

export function buildInstallationPlan({ workflow, assessment, targetAgentIds, actor, homeDirectory, basedOnRevision }) {
  const targets = resolveAgentTargets(targetAgentIds, { homeDirectory });
  const required = (workflow.stages || []).flatMap((stage) => (stage.capabilities || [])
    .filter((capability) => capability.required !== false)
    .map((capability) => ({
      key: capabilityKey(stage.id, capability.id),
      stageId: stage.id,
      capabilityId: capability.id,
      label: capability.label,
    })));
  const items = [
    ...localItems(assessment, targets, homeDirectory),
    ...externalItems(workflow, targets, homeDirectory),
  ];
  const uncovered = chooseMinimalSet(items, required.map((capability) => capability.key));
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind: "skill-installation",
    status: "draft",
    workflowId: workflow.id,
    basedOnRevision,
    targetAgents: targets.map((target) => target.id),
    sharedRoot: sharedSkillRoot(homeDirectory),
    items,
    coverage: {
      required: required.length,
      covered: required.length - uncovered.size,
      uncovered: required.filter((capability) => uncovered.has(capability.key)),
    },
    execution: {
      jobId: null,
      startedAt: null,
      completedAt: null,
      cancelRequestedAt: null,
      reloadPending: [],
      journalPath: "",
      residualPaths: [],
      message: "",
    },
    reassessment: [],
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor,
  };
}
