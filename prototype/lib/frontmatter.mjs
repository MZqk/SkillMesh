function stripQuotes(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      if (first === '"') {
        try {
          return JSON.parse(trimmed);
        } catch {
          return trimmed.slice(1, -1);
        }
      }
      return trimmed.slice(1, -1).replaceAll("''", "'");
    }
  }
  return trimmed;
}

function splitInlineList(value) {
  const items = [];
  let quote = "";
  let current = "";
  for (const character of value) {
    if ((character === '"' || character === "'") && (!quote || quote === character)) {
      quote = quote ? "" : character;
      current += character;
      continue;
    }
    if (character === "," && !quote) {
      items.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim() || items.length) items.push(current);
  return items;
}

function parseScalar(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (/^(?:true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  if (/^(?:null|~)$/i.test(trimmed)) return null;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    return inner ? splitInlineList(inner).map((item) => parseScalar(item)) : [];
  }
  return stripQuotes(trimmed);
}

function parseFlatYaml(frontmatter) {
  const lines = frontmatter.split(/\r?\n/);
  const metadata = {};
  const diagnostics = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (!match) continue;

    const [, key, raw = ""] = match;
    if (/^[>|][+-]?$/.test(raw.trim())) {
      const block = [];
      const folded = raw.trim().startsWith(">");
      while (index + 1 < lines.length) {
        const next = lines[index + 1];
        if (next && !/^\s+/.test(next)) break;
        index += 1;
        block.push(next.replace(/^\s{1,4}/, ""));
      }
      metadata[key] = folded ? block.join(" ").replace(/\s+/g, " ").trim() : block.join("\n").trim();
      continue;
    }

    if (!raw.trim()) {
      const items = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const next = lines[cursor];
        if (!next.trim()) {
          cursor += 1;
          continue;
        }
        const item = next.match(/^\s+-\s*(.*?)\s*$/);
        if (!item) break;
        items.push(parseScalar(item[1]));
        cursor += 1;
      }
      if (items.length) {
        metadata[key] = items;
        index = cursor - 1;
        continue;
      }
    }

    metadata[key] = parseScalar(raw);
  }

  if (!Object.keys(metadata).length && frontmatter.trim()) {
    diagnostics.push("frontmatter-unparsed");
  }
  return { metadata, diagnostics };
}

export function parseSkillDocument(contents, fallbackName = "unnamed-skill") {
  const normalized = contents.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) {
    return {
      metadata: {},
      name: fallbackName,
      description: "",
      body: normalized,
      diagnostics: ["frontmatter-missing"],
    };
  }

  const { metadata, diagnostics } = parseFlatYaml(match[1]);
  const name = String(metadata.name || fallbackName).trim();
  const description = String(metadata.description || "").trim();
  if (!metadata.name) diagnostics.push("name-missing");
  if (!description) diagnostics.push("description-missing");

  return {
    metadata,
    name,
    description,
    body: normalized.slice(match[0].length),
    diagnostics,
  };
}
