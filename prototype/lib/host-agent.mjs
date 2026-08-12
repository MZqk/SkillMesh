const HOST_DEFINITIONS = Object.freeze([
  {
    id: "workbuddy",
    label: "WorkBuddy",
    agentId: "workbuddy",
    aliases: ["workbuddy", "work-buddy"],
  },
  {
    id: "codex",
    label: "Codex",
    agentId: "codex",
    aliases: ["codex", "openai-codex", "codex-desktop"],
  },
]);

function normalized(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_]+/g, "-");
}

export function resolveMcpHost(clientVersion = {}) {
  const clientName = String(clientVersion?.name || "unknown-mcp-host").slice(0, 200);
  const clientVersionValue = String(clientVersion?.version || "").slice(0, 100);
  const name = normalized(clientName);
  const definition = HOST_DEFINITIONS.find((candidate) =>
    candidate.aliases.some((alias) => name === alias || name.includes(alias)));
  if (!definition) {
    return {
      id: "unknown",
      label: clientName || "未知宿主",
      currentAgent: null,
      recognized: false,
      clientName,
      clientVersion: clientVersionValue,
    };
  }
  return {
    id: definition.id,
    label: definition.label,
    currentAgent: definition.agentId,
    recognized: true,
    clientName,
    clientVersion: clientVersionValue,
  };
}

export function humanAppActor(clientVersion = {}) {
  const host = resolveMcpHost(clientVersion);
  return {
    type: "human",
    name: "local-user",
    version: host.clientVersion,
    channel: "mcp-app",
  };
}
