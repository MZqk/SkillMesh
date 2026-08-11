function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left === "*" ? -1 : right === "*" ? 1 : left.localeCompare(right));
}

export function skillPreference(skill) {
  const scope = { project: 5, user: 4, custom: 3, "plugin-cache": 2, internal: 1 }[skill.scope] || 0;
  return (skill.enabled === false ? -100 : 0)
    + (skill.sourceKind === "direct" ? 20 : 0)
    + scope
    + (skill.metadataStatus === "complete" ? 1 : 0);
}

export function mergeSkillCopies(copies) {
  if (!Array.isArray(copies) || !copies.length) return null;
  const ranked = [...copies].sort((left, right) =>
    skillPreference(right) - skillPreference(left)
      || String(left.path || "").localeCompare(String(right.path || "")));
  const representative = ranked[0];
  const enabledCopies = ranked.filter((skill) => skill.enabled !== false);
  const providers = uniqueStrings(ranked.map((skill) => skill.provider));
  const supportedAgents = uniqueStrings(ranked.flatMap((skill) => skill.supportedAgents || []));

  return {
    ...representative,
    enabled: enabledCopies.length > 0,
    disabledReason: enabledCopies.length ? "" : representative.disabledReason,
    supportedAgents,
    providers,
    scopes: uniqueStrings(ranked.map((skill) => skill.scope)),
    sourceKinds: uniqueStrings(ranked.map((skill) => skill.sourceKind)),
    allowedTools: uniqueStrings(ranked.flatMap((skill) => skill.allowedTools || [])),
    triggers: uniqueStrings(ranked.flatMap((skill) => skill.triggers || [])),
    keywords: uniqueStrings(ranked.flatMap((skill) => skill.keywords || [])),
    invocation: ranked.map((skill) => skill.invocation).find(Boolean) || "",
    identity: {
      ...(representative.identity || {}),
      contentCopies: ranked.length,
      providers,
      supportedAgents,
      enabledCopies: enabledCopies.length,
      disabledCopies: ranked.length - enabledCopies.length,
    },
  };
}

export function canonicalSkills(skills) {
  const byContent = new Map();
  for (const skill of skills || []) {
    const identityKey = skill.contentHash || skill.id;
    if (!identityKey) continue;
    if (!byContent.has(identityKey)) byContent.set(identityKey, []);
    byContent.get(identityKey).push(skill);
  }
  return [...byContent.values()].map(mergeSkillCopies).filter(Boolean);
}
