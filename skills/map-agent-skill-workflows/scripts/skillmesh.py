#!/usr/bin/env python3
"""Read-only local Agent Skill inventory, evidence mapping, and bounded review."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = "1.0"
MAX_SKILL_BYTES = 512 * 1024
MAX_REVIEW_BYTES = 2 * 1024 * 1024
MAX_FILES_PER_ROOT = 2000
MAX_DEPTH = 10
SKIP_DIRECTORIES = {".git", "node_modules", "dist", "build", ".next", ".cache", "__pycache__"}
NESTED_AGENT_MIRRORS = {
    ".agents", ".claude", ".cline", ".codex", ".continue", ".copilot", ".cursor",
    ".factory", ".gemini", ".hermes", ".kiro", ".openclaw", ".opencode", ".trae", ".windsurf",
}
GENERIC_TERMS = {
    "agent", "analysis", "build", "create", "development", "implementation", "plan", "planning",
    "quality", "skill", "skills", "test", "testing", "validate", "workflow",
    "分析", "创建", "开发", "构建", "技能", "测试", "计划", "验证", "质量",
}
USER_ROOTS = (
    ".agents/skills", ".config/agents/skills", ".codex/skills", ".codex/plugins/cache",
    ".claude/skills", ".claude/plugins/cache", ".cursor/skills", ".gemini/skills",
    ".config/opencode/skills", ".windsurf/skills", ".cline/skills", ".continue/skills",
    ".copilot/skills", ".workbuddy/skills", ".workbuddy/plugins/cache", ".openclaw/skills",
)
PROJECT_ROOTS = (
    ".agents/skills", ".codex/skills", ".claude/skills", ".cursor/skills", ".gemini/skills",
    ".opencode/skills", ".windsurf/skills", ".cline/skills", ".continue/skills", ".github/skills", "skills",
)
RISK_RULES = (
    ("critical", "destructive-delete", re.compile(r"\b(?:rm\s+-[^\n]*r[^\n]*f|rmdir\s+/s|Remove-Item\b[^\n]*-Recurse)", re.I)),
    ("high", "privilege-escalation", re.compile(r"\b(?:sudo|doas)\b", re.I)),
    ("high", "remote-pipe-execution", re.compile(r"(?:curl|wget)\b[^\n|]{0,300}\|\s*(?:sh|bash|zsh|python|node)\b", re.I)),
    ("high", "credential-access", re.compile(r"(?:\.ssh/|\.aws/credentials|\.env\b|api[_ -]?key|access[_ -]?token|private[_ -]?key)", re.I)),
    ("high", "instruction-override", re.compile(r"(?:ignore|disregard|bypass).{0,80}(?:instruction|policy|approval|safety)", re.I)),
    ("medium", "broad-permissions", re.compile(r"\bchmod\s+(?:-R\s+)?777\b", re.I)),
    ("medium", "network-reference", re.compile(r"https?://[^\s)>\]]+", re.I)),
    ("medium", "package-install", re.compile(r"\b(?:npm|pnpm|yarn|pipx?|brew|apt(?:-get)?)\s+install\b", re.I)),
)


class SkillMeshError(Exception):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    text = re.sub(r"[\u2010-\u2015]", "-", text)
    text = re.sub(r"[^\w+#.\-\u3400-\u9fff]+", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text.replace("_", " ").replace("-", " ")).strip()


def slug(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower().strip()
    text = re.sub(r"[^\w\u3400-\u9fff]+", "-", text, flags=re.UNICODE)
    return text.strip("-")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def bounded_content_hash(prefix: bytes, file_size: int) -> str:
    suffix = f"\0truncated:{file_size}".encode() if file_size > MAX_SKILL_BYTES else b""
    return sha256_bytes(prefix[:MAX_SKILL_BYTES] + suffix)


def scalar(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        if value[0] == '"':
            try:
                return str(json.loads(value))
            except json.JSONDecodeError:
                pass
        return value[1:-1]
    if value in {"null", "~"}:
        return ""
    return value


def parse_inline_list(value: str) -> list[str]:
    inner = value.strip()[1:-1].strip()
    if not inner:
        return []
    try:
        decoded = json.loads(value)
        if isinstance(decoded, list):
            return [str(item).strip() for item in decoded if str(item).strip()]
    except json.JSONDecodeError:
        pass
    return [scalar(item) for item in re.split(r",\s*", inner) if scalar(item)]


def parse_frontmatter(text: str, fallback_name: str) -> tuple[dict[str, Any], str, list[str]]:
    diagnostics: list[str] = []
    normalized_text = text.lstrip("\ufeff")
    if not normalized_text.startswith("---\n") and not normalized_text.startswith("---\r\n"):
        return {"name": fallback_name, "description": ""}, normalized_text, ["missing-frontmatter"]
    match = re.match(r"^---\s*\r?\n(.*?)\r?\n---\s*(?:\r?\n|$)", normalized_text, re.S)
    if not match:
        return {"name": fallback_name, "description": ""}, normalized_text, ["unterminated-frontmatter"]
    block = match.group(1)
    body = normalized_text[match.end():]
    lines = block.splitlines()
    metadata: dict[str, Any] = {}
    index = 0
    while index < len(lines):
        line = lines[index]
        if not line.strip() or line.lstrip().startswith("#"):
            index += 1
            continue
        field = re.match(r"^([A-Za-z0-9_-]+):(?:\s*(.*))?$", line)
        if not field:
            diagnostics.append(f"unparsed-frontmatter-line:{index + 1}")
            index += 1
            continue
        key, raw = field.group(1), (field.group(2) or "").strip()
        if raw in {"|", ">", "|-", ">-", "|+", ">+"}:
            collected: list[str] = []
            index += 1
            while index < len(lines) and (not lines[index].strip() or lines[index][0].isspace()):
                collected.append(lines[index].lstrip())
                index += 1
            metadata[key] = "\n".join(collected).strip() if raw.startswith("|") else " ".join(item.strip() for item in collected).strip()
            continue
        if raw.startswith("[") and raw.endswith("]"):
            metadata[key] = parse_inline_list(raw)
            index += 1
            continue
        if not raw:
            collected = []
            lookahead = index + 1
            while lookahead < len(lines) and (not lines[lookahead].strip() or lines[lookahead][0].isspace()):
                item = re.match(r"^\s*-\s*(.+)$", lines[lookahead])
                if item:
                    collected.append(scalar(item.group(1)))
                lookahead += 1
            metadata[key] = collected if collected else ""
            index = lookahead
            continue
        metadata[key] = scalar(raw)
        index += 1
    name = str(metadata.get("name") or fallback_name).strip()
    description = str(metadata.get("description") or "").strip()
    if not metadata.get("name"):
        diagnostics.append("missing-name")
    if not description:
        diagnostics.append("missing-description")
    metadata["name"] = name
    metadata["description"] = description
    return metadata, body, diagnostics


def as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if value in (None, ""):
        return []
    return [item.strip() for item in re.split(r"[,|]", str(value)) if item.strip()]


def as_bool(value: Any, fallback: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if str(value).strip().lower() in {"true", "yes", "on", "1"}:
        return True
    if str(value).strip().lower() in {"false", "no", "off", "0"}:
        return False
    return fallback


def provider_for(path: Path) -> str:
    text = str(path).replace("\\", "/")
    for provider in ("codex", "claude", "cursor", "gemini", "workbuddy", "openclaw", "opencode", "cline", "continue"):
        if f".{provider}/" in text:
            return provider
    if "/.agents/" in text or "/.config/agents/" in text:
        return "agent-skills"
    if "/plugins/cache/" in text:
        return "plugin-cache"
    return "project-or-custom"


def default_roots(project: Path) -> list[Path]:
    roots = [Path.home() / item for item in USER_ROOTS]
    roots.extend(project.resolve() / item for item in PROJECT_ROOTS)
    result: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        key = str(root)
        if key not in seen:
            seen.add(key)
            result.append(root)
    return result


def discover_skill_files(root: Path) -> tuple[list[Path], bool]:
    found: list[Path] = []
    truncated = False

    def walk(directory: Path, depth: int, ancestors: frozenset[str]) -> None:
        nonlocal truncated
        if truncated or depth > MAX_DEPTH:
            return
        try:
            real = str(directory.resolve(strict=True))
        except (OSError, RuntimeError):
            return
        if real in ancestors:
            return
        try:
            entries = sorted(directory.iterdir(), key=lambda item: item.name.lower())
        except OSError:
            return
        next_ancestors = ancestors | {real}
        for entry in entries:
            if truncated:
                return
            if entry.name in SKIP_DIRECTORIES or (depth > 0 and entry.name in NESTED_AGENT_MIRRORS):
                continue
            try:
                if entry.is_dir():
                    walk(entry, depth + 1, frozenset(next_ancestors))
                elif entry.is_file() and entry.name == "SKILL.md":
                    found.append(entry)
                    if len(found) >= MAX_FILES_PER_ROOT:
                        truncated = True
            except OSError:
                continue

    walk(root, 0, frozenset())
    return found, truncated


def read_skill(skill_path: Path, root: Path) -> dict[str, Any]:
    stat = skill_path.stat()
    with skill_path.open("rb") as handle:
        data = handle.read(MAX_SKILL_BYTES)
    truncated = stat.st_size > MAX_SKILL_BYTES
    content_hash = bounded_content_hash(data, stat.st_size)
    text = data.decode("utf-8", errors="replace")
    metadata, body, diagnostics = parse_frontmatter(text, skill_path.parent.name)
    if truncated:
        diagnostics.append("file-too-large")
    disabled = as_bool(metadata.get("disabled", metadata.get("disable")), False)
    real_path = skill_path.resolve()
    supported_agents = as_list(metadata.get("agents", metadata.get("agent", metadata.get("supported-agents"))))
    source_kind = "derived" if "/plugins/cache/" in str(skill_path).replace("\\", "/") else "direct"
    return {
        "id": hashlib.sha256(f"{skill_path.resolve()}\0{content_hash}".encode()).hexdigest()[:20],
        "logicalName": slug(metadata["name"]) or slug(skill_path.parent.name),
        "name": metadata["name"],
        "description": metadata["description"],
        "provider": provider_for(root),
        "sourceKind": source_kind,
        "rootPath": str(root.resolve()),
        "path": str(skill_path.resolve()),
        "realPath": str(real_path),
        "relativePath": str(skill_path.relative_to(root)),
        "isAlias": skill_path.absolute() != real_path,
        "contentHash": content_hash,
        "bytes": stat.st_size,
        "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat().replace("+00:00", "Z"),
        "metadataStatus": "complete" if not {"missing-name", "missing-description"} & set(diagnostics) else "incomplete",
        "enabled": not disabled,
        "supportedAgents": supported_agents,
        "allowedTools": as_list(metadata.get("allowed-tools", metadata.get("allowed_tools"))),
        "version": str(metadata.get("version") or ""),
        "license": str(metadata.get("license") or ""),
        "sourceUrl": str(metadata.get("source") or metadata.get("repository") or ""),
        "diagnostics": sorted(set(diagnostics)),
        "searchText": f"{metadata['name']}\n{metadata['description']}\n{body[:24000]}",
        "body": body[:24000],
    }


def annotate_identity(skills: list[dict[str, Any]]) -> dict[str, int]:
    by_hash: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_real: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for skill in skills:
        by_hash[skill["contentHash"]].append(skill)
        by_name[skill["logicalName"]].append(skill)
        by_real[skill["realPath"]].append(skill)
    for skill in skills:
        name_hashes = {item["contentHash"] for item in by_name[skill["logicalName"]]}
        skill["identity"] = {
            "contentCopies": len(by_hash[skill["contentHash"]]),
            "nameVariants": len(name_hashes),
            "physicalAliases": len(by_real[skill["realPath"]]),
            "duplicateContent": len(by_hash[skill["contentHash"]]) > 1,
            "nameConflict": len(name_hashes) > 1,
        }
    return {
        "uniqueContent": len(by_hash),
        "duplicateContentGroups": sum(len(items) > 1 for items in by_hash.values()),
        "nameConflictGroups": sum(len({item["contentHash"] for item in items}) > 1 for items in by_name.values()),
        "physicalAliasGroups": sum(len(items) > 1 for items in by_real.values()),
    }


def scan_roots(roots: Iterable[Path]) -> dict[str, Any]:
    skills: list[dict[str, Any]] = []
    root_results: list[dict[str, Any]] = []
    for root in roots:
        root = root.expanduser().resolve()
        if not root.exists() or not root.is_dir():
            root_results.append({"path": str(root), "available": False, "files": 0, "truncated": False, "errors": []})
            continue
        files, truncated = discover_skill_files(root)
        errors = []
        accepted = 0
        for file_path in files:
            try:
                skills.append(read_skill(file_path, root))
                accepted += 1
            except (OSError, ValueError) as error:
                errors.append({"path": str(file_path), "message": str(error)})
        root_results.append({
            "path": str(root), "provider": provider_for(root), "available": True,
            "files": accepted, "truncated": truncated, "errors": errors,
        })
    skills.sort(key=lambda item: (normalize(item["name"]), item["path"]))
    identity = annotate_identity(skills)
    provider_counts = Counter(skill["provider"] for skill in skills)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": now_iso(),
        "readOnly": True,
        "roots": root_results,
        "stats": {
            "paths": len(skills),
            **identity,
            "incompleteMetadata": sum(skill["metadataStatus"] == "incomplete" for skill in skills),
            "enabled": sum(skill["enabled"] for skill in skills),
            "disabled": sum(not skill["enabled"] for skill in skills),
            "derivedPaths": sum(skill["sourceKind"] == "derived" for skill in skills),
            "providers": dict(sorted(provider_counts.items())),
        },
        "skills": skills,
    }


def public_inventory(inventory: dict[str, Any]) -> dict[str, Any]:
    clean = dict(inventory)
    clean["skills"] = [{key: value for key, value in skill.items() if key not in {"searchText", "body"}} for skill in inventory["skills"]]
    return clean


def load_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise SkillMeshError(f"Cannot read {label}: {error}") from error
    except json.JSONDecodeError as error:
        raise SkillMeshError(f"Invalid {label} JSON at line {error.lineno}, column {error.colno}: {error.msg}") from error


def validate_workflow(workflow: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(workflow, dict):
        return ["workflow must be a JSON object"]
    for field in ("id", "name", "version"):
        if not str(workflow.get(field) or "").strip():
            errors.append(f"workflow.{field} must be non-empty")
    stages = workflow.get("stages")
    if not isinstance(stages, list) or not stages:
        return errors + ["workflow.stages must be a non-empty array"]
    stage_ids: list[str] = []
    capability_ids: set[str] = set()
    for index, stage in enumerate(stages):
        prefix = f"stages[{index}]"
        if not isinstance(stage, dict):
            errors.append(f"{prefix} must be an object")
            continue
        stage_id = str(stage.get("id") or "")
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", stage_id):
            errors.append(f"{prefix}.id must use lowercase hyphen-case")
        elif stage_id in stage_ids:
            errors.append(f"duplicate stage id: {stage_id}")
        stage_ids.append(stage_id)
        for field in ("title", "acceptanceGate"):
            if not str(stage.get(field) or "").strip():
                errors.append(f"{prefix}.{field} must be non-empty")
        dependencies = stage.get("dependencies", [])
        if not isinstance(dependencies, list):
            errors.append(f"{prefix}.dependencies must be an array")
        capabilities = stage.get("capabilities")
        if not isinstance(capabilities, list) or not capabilities:
            errors.append(f"{prefix}.capabilities must be a non-empty array")
            continue
        for cap_index, capability in enumerate(capabilities):
            cap_prefix = f"{prefix}.capabilities[{cap_index}]"
            if not isinstance(capability, dict):
                errors.append(f"{cap_prefix} must be an object")
                continue
            capability_id = str(capability.get("id") or "")
            if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", capability_id):
                errors.append(f"{cap_prefix}.id must use lowercase hyphen-case")
            elif capability_id in capability_ids:
                errors.append(f"duplicate capability id: {capability_id}")
            capability_ids.add(capability_id)
            if not str(capability.get("label") or "").strip():
                errors.append(f"{cap_prefix}.label must be non-empty")
            terms = capability.get("terms")
            if not isinstance(terms, list) or not any(str(term).strip() for term in terms):
                errors.append(f"{cap_prefix}.terms must be a non-empty array")
    known = set(stage_ids)
    positions = {stage_id: index for index, stage_id in enumerate(stage_ids)}
    for index, stage in enumerate(stages):
        if not isinstance(stage, dict):
            continue
        stage_id = str(stage.get("id") or "")
        for dependency in stage.get("dependencies", []) if isinstance(stage.get("dependencies", []), list) else []:
            if dependency == stage_id:
                errors.append(f"stage {stage_id} cannot depend on itself")
            elif dependency not in known:
                errors.append(f"stage {stage_id} has unknown dependency: {dependency}")
            elif positions.get(dependency, index) >= index:
                errors.append(f"stage {stage_id} dependency must refer to an earlier stage: {dependency}")
    return errors


def term_specificity(term: str) -> float:
    normal = normalize(term)
    parts = normal.split()
    if normal in GENERIC_TERMS:
        return 0.35
    if len(parts) > 1 or any("\u3400" <= char <= "\u9fff" for char in normal):
        return 1.0
    if len(normal) >= 8:
        return 0.9
    return 0.7


def contains_term(field: str, term: str) -> bool:
    normalized_field = normalize(field)
    normalized_term = normalize(term)
    if not normalized_term:
        return False
    if re.fullmatch(r"[a-z0-9+#.]{1,3}", normalized_term):
        return normalized_term in normalized_field.split()
    return normalized_term in normalized_field


def text_tokens(value: str) -> set[str]:
    normalized = normalize(value)
    tokens = {token for token in normalized.split() if len(token) > 1 and token not in GENERIC_TERMS}
    cjk = "".join(re.findall(r"[\u3400-\u9fff]", normalized))
    tokens.update(cjk[index:index + 2] for index in range(max(0, len(cjk) - 1)))
    return tokens


def score_candidate(skill: dict[str, Any], capability: dict[str, Any], target_agent: str | None) -> tuple[float, list[dict[str, Any]]]:
    if not skill["enabled"]:
        return 0.0, []
    supported = [normalize(item) for item in skill.get("supportedAgents", [])]
    if target_agent and supported and "*" not in supported and normalize(target_agent) not in supported:
        return 0.0, []
    fields = (
        ("name", skill["name"], 1.0),
        ("description", skill["description"], 0.84),
        ("body", skill["body"], 0.36),
    )
    hits: list[dict[str, Any]] = []
    for raw_term in capability.get("terms", []):
        term = str(raw_term).strip()
        best: dict[str, Any] | None = None
        for field_name, value, weight in fields:
            if contains_term(value, term):
                strength = weight * term_specificity(term)
                hit = {"term": term, "field": field_name, "strength": round(strength, 3)}
                if best is None or hit["strength"] > best["strength"]:
                    best = hit
        if best:
            hits.append(best)
    hits.sort(key=lambda item: (-item["strength"], normalize(item["term"])))
    if not hits:
        return 0.0, []
    evidence = min(1.0, hits[0]["strength"] + sum(hit["strength"] * 0.14 for hit in hits[1:4]))
    context = text_tokens(f"{capability.get('label', '')} {' '.join(capability.get('acceptanceCriteria', []))}")
    summary = text_tokens(f"{skill['name']} {skill['description']}")
    overlap = len(context & summary) / max(1, min(len(context), 6))
    score = min(1.0, evidence * 0.86 + overlap * 0.14)
    if skill["metadataStatus"] != "complete":
        score *= 0.82
    if skill["sourceKind"] == "derived":
        score *= 0.94
    if skill.get("identity", {}).get("nameConflict"):
        score *= 0.88
    return round(score, 3), hits[:5]


def load_decisions(path: Path | None) -> dict[str, dict[str, Any]]:
    if path is None:
        return {}
    document = load_json(path, "decisions")
    raw = document.get("decisions") if isinstance(document, dict) else None
    if not isinstance(raw, dict):
        raise SkillMeshError("decisions JSON must contain an object named 'decisions'")
    decisions: dict[str, dict[str, Any]] = {}
    for content_hash, value in raw.items():
        if not re.fullmatch(r"[a-f0-9]{64}", str(content_hash)):
            raise SkillMeshError(f"invalid decision content hash: {content_hash}")
        if not isinstance(value, dict):
            raise SkillMeshError(f"decision for {content_hash} must be an object")
        reviewed_by = str(value.get("reviewedBy") or "unspecified")
        if reviewed_by not in {"agent", "human", "unspecified"}:
            raise SkillMeshError(f"invalid reviewedBy for {content_hash}: {reviewed_by}")
        raw_capabilities = value.get("capabilities")
        if not isinstance(raw_capabilities, dict) or not raw_capabilities:
            raise SkillMeshError(f"decision for {content_hash} must contain a non-empty capabilities object")
        capabilities: dict[str, dict[str, str]] = {}
        for capability_id, capability_value in raw_capabilities.items():
            if isinstance(capability_value, str):
                capability_item = {"decision": capability_value, "rationale": ""}
            elif isinstance(capability_value, dict):
                capability_item = {
                    "decision": str(capability_value.get("decision") or ""),
                    "rationale": str(capability_value.get("rationale") or ""),
                }
            else:
                raise SkillMeshError(f"decision for {content_hash}/{capability_id} must be a string or object")
            if capability_item["decision"] not in {"confirmed", "partial", "excluded"}:
                raise SkillMeshError(f"invalid decision for {content_hash}/{capability_id}: {capability_item['decision']}")
            capabilities[str(capability_id)] = capability_item
        item = {"reviewedBy": reviewed_by, "capabilities": capabilities}
        decisions[str(content_hash)] = item
    return decisions


def build_plan(workflow: dict[str, Any], inventory: dict[str, Any], decisions: dict[str, dict[str, Any]], target_agent: str | None, top: int) -> dict[str, Any]:
    errors = validate_workflow(workflow)
    if errors:
        raise SkillMeshError("Invalid workflow:\n- " + "\n- ".join(errors))
    plan_stages: list[dict[str, Any]] = []
    trusted_route: list[dict[str, Any]] = []
    recommended_route: list[dict[str, Any]] = []
    gaps: list[dict[str, Any]] = []
    counts = Counter()
    stages = sorted(workflow["stages"], key=lambda item: (item.get("order", 10**9), workflow["stages"].index(item)))
    for stage_order, stage in enumerate(stages, 1):
        capability_results = []
        for capability in stage["capabilities"]:
            candidates = []
            for skill in inventory["skills"]:
                score, evidence = score_candidate(skill, capability, target_agent)
                if score < 0.28:
                    continue
                document_decision = decisions.get(skill["contentHash"])
                decision = document_decision.get("capabilities", {}).get(capability["id"]) if document_decision else None
                candidates.append({
                    "id": skill["id"], "name": skill["name"], "path": skill["path"],
                    "provider": skill["provider"], "sourceKind": skill["sourceKind"],
                    "contentHash": skill["contentHash"], "score": score, "evidence": evidence,
                    "decision": decision["decision"] if decision else "unreviewed",
                    "reviewedBy": document_decision["reviewedBy"] if decision else None,
                    "rationale": decision["rationale"] if decision else "",
                    "identity": skill["identity"],
                })
            candidates.sort(key=lambda item: (
                item["decision"] == "excluded", -item["score"], item["sourceKind"] == "derived", normalize(item["name"]), item["path"],
            ))
            candidates = candidates[:top]
            eligible = [item for item in candidates if item["decision"] != "excluded"]
            primary = eligible[0] if eligible else None
            if not primary:
                status = "missing"
            elif primary["decision"] == "confirmed":
                status = "confirmed"
            elif primary["decision"] == "partial":
                status = "partial"
            else:
                status = "evidenced"
            required = bool(capability.get("required", True))
            counts[status] += 1
            result = {
                "id": capability["id"], "label": capability["label"], "required": required,
                "status": status, "primary": primary, "candidates": candidates,
            }
            capability_results.append(result)
            if required and status == "missing":
                gaps.append({"stageId": stage["id"], "stageTitle": stage["title"], "capabilityId": capability["id"], "label": capability["label"]})
            if primary and status == "confirmed":
                trusted_route.append({
                    "order": len(trusted_route) + 1, "stageId": stage["id"], "stageTitle": stage["title"],
                    "capabilityId": capability["id"], "skill": primary,
                })
            if primary:
                recommended_route.append({
                    "order": len(recommended_route) + 1, "stageId": stage["id"], "stageTitle": stage["title"],
                    "capabilityId": capability["id"], "status": status, "skill": primary,
                })
        required_results = [item for item in capability_results if item["required"]]
        statuses = {item["status"] for item in required_results}
        if required_results and statuses == {"confirmed"}:
            stage_status = "complete"
        elif required_results and statuses == {"missing"}:
            stage_status = "missing"
        elif "missing" in statuses:
            stage_status = "partial"
        else:
            stage_status = "evidenced"
        plan_stages.append({
            "id": stage["id"], "order": stage.get("order", stage_order), "title": stage["title"],
            "summary": stage.get("summary", ""), "dependencies": stage.get("dependencies", []),
            "deliverables": stage.get("deliverables", []), "acceptanceGate": stage["acceptanceGate"],
            "status": stage_status, "capabilities": capability_results,
        })
    decision_hashes = set(decisions)
    inventory_hashes = {skill["contentHash"] for skill in inventory["skills"]}
    stale = sorted(decision_hashes - inventory_hashes)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": now_iso(),
        "readOnly": True,
        "workflow": {key: workflow.get(key) for key in ("id", "name", "version", "description")},
        "mappingScope": {"targetAgent": target_agent, "roots": [root["path"] for root in inventory["roots"]]},
        "inventoryStats": inventory["stats"],
        "summary": {
            "stages": len(plan_stages), "capabilities": sum(counts.values()),
            "confirmed": counts["confirmed"], "partial": counts["partial"],
            "evidenced": counts["evidenced"], "missing": counts["missing"],
            "requiredGaps": len(gaps), "trustedRouteSteps": len(trusted_route),
            "recommendedRouteSteps": len(recommended_route), "staleDecisions": len(stale),
        },
        "stages": plan_stages,
        "trustedRoute": trusted_route,
        "recommendedRoute": recommended_route,
        "gaps": gaps,
        "staleDecisionHashes": stale,
        "assumptions": [
            "Textual evidence is not runtime validation.",
            "Only hash-bound confirmed candidates enter trustedRoute.",
            "Static matching does not authorize installation or execution.",
        ],
    }


def inventory_markdown(inventory: dict[str, Any]) -> str:
    stats = inventory["stats"]
    lines = [
        "# Local Agent Skill inventory", "",
        f"Generated: {inventory['generatedAt']}",
        f"Paths: {stats['paths']} · unique content: {stats['uniqueContent']} · enabled: {stats['enabled']} · disabled: {stats['disabled']}",
        f"Duplicate groups: {stats['duplicateContentGroups']} · name conflicts: {stats['nameConflictGroups']} · incomplete metadata: {stats['incompleteMetadata']}",
        "", "## Roots", "",
    ]
    for root in inventory["roots"]:
        state = "available" if root["available"] else "missing"
        lines.append(f"- `{root['path']}` — {state}, {root['files']} Skill paths" + (", truncated" if root["truncated"] else ""))
    lines.extend(["", "## Skills", ""])
    for skill in inventory["skills"]:
        flags = []
        if not skill["enabled"]:
            flags.append("disabled")
        if skill["identity"]["duplicateContent"]:
            flags.append("duplicate")
        if skill["identity"]["nameConflict"]:
            flags.append("name-conflict")
        if skill["metadataStatus"] != "complete":
            flags.append("incomplete-metadata")
        suffix = f" ({', '.join(flags)})" if flags else ""
        lines.append(f"- **{skill['name']}**{suffix} — {skill['description'] or 'No description'}")
        lines.append(f"  `{skill['path']}` · `{skill['contentHash']}`")
    return "\n".join(lines).rstrip() + "\n"


def plan_markdown(plan: dict[str, Any]) -> str:
    summary = plan["summary"]
    lines = [
        f"# {plan['workflow']['name']} — Skill map", "",
        f"Workflow: `{plan['workflow']['id']}` v{plan['workflow']['version']}",
        f"Coverage: {summary['confirmed']} confirmed · {summary['partial']} partial · {summary['evidenced']} evidenced · {summary['missing']} missing",
        f"Routes: {summary['trustedRouteSteps']} trusted steps · {summary['recommendedRouteSteps']} recommended steps · {summary['requiredGaps']} required gaps",
        "",
    ]
    for stage in plan["stages"]:
        lines.extend([f"## {int(stage['order']):02d}. {stage['title']} — {stage['status']}", ""])
        for capability in stage["capabilities"]:
            marker = "required" if capability["required"] else "optional"
            lines.append(f"- **{capability['label']}** ({marker}): {capability['status']}")
            primary = capability["primary"]
            if primary:
                decision = primary["decision"]
                reviewer = f" by {primary['reviewedBy']}" if primary.get("reviewedBy") else ""
                lines.append(f"  - Primary: `{primary['name']}` · score {primary['score']:.3f} · {decision}{reviewer}")
                lines.append(f"  - Path: `{primary['path']}`")
                evidence = ", ".join(f"{item['term']}@{item['field']}" for item in primary["evidence"])
                lines.append(f"  - Evidence: {evidence}")
        lines.extend([f"- Acceptance gate: {stage['acceptanceGate']}", ""])
    lines.extend(["## Trusted route", ""])
    if plan["trustedRoute"]:
        for item in plan["trustedRoute"]:
            lines.append(f"{item['order']}. `{item['skill']['name']}` — {item['stageTitle']} / {item['capabilityId']}")
    else:
        lines.append("No Skill is confirmed for the trusted route yet.")
    lines.extend(["", "## Recommended route (may be unreviewed)", ""])
    for item in plan["recommendedRoute"]:
        lines.append(f"{item['order']}. `{item['skill']['name']}` — {item['stageTitle']} / {item['capabilityId']} ({item['status']})")
    lines.extend(["", "## Required gaps", ""])
    if plan["gaps"]:
        for gap in plan["gaps"]:
            lines.append(f"- {gap['stageTitle']}: {gap['label']} (`{gap['capabilityId']}`)")
    else:
        lines.append("No required capability is missing textual evidence.")
    if plan["staleDecisionHashes"]:
        lines.extend(["", "## Stale decisions", ""])
        lines.extend(f"- `{item}`" for item in plan["staleDecisionHashes"])
    lines.extend(["", "> Textual evidence is not runtime validation. Only hash-bound confirmed candidates enter the trusted route.", ""])
    return "\n".join(lines)


def review_skill(path: Path) -> dict[str, Any]:
    if path.is_dir():
        path = path / "SKILL.md"
    if path.name != "SKILL.md":
        raise SkillMeshError("--skill must point to a SKILL.md file or its directory")
    try:
        data = path.read_bytes()
    except OSError as error:
        raise SkillMeshError(f"Cannot read Skill: {error}") from error
    if len(data) > MAX_REVIEW_BYTES:
        raise SkillMeshError(f"Skill document exceeds review limit of {MAX_REVIEW_BYTES} bytes")
    text = data.decode("utf-8", errors="replace")
    metadata, body, diagnostics = parse_frontmatter(text, path.parent.name)
    findings = []
    lines = text.splitlines()
    for severity, rule, pattern in RISK_RULES:
        for line_number, line in enumerate(lines, 1):
            match = pattern.search(line)
            if match:
                excerpt = re.sub(r"\s+", " ", line.strip())[:240]
                findings.append({"severity": severity, "rule": rule, "line": line_number, "excerpt": excerpt})
                if sum(item["rule"] == rule for item in findings) >= 5:
                    break
    severity_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    findings.sort(key=lambda item: (severity_rank[item["severity"]], item["line"], item["rule"]))
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": now_iso(),
        "readOnly": True,
        "path": str(path.resolve()),
        "contentHash": bounded_content_hash(data, len(data)),
        "fullContentHash": sha256_bytes(data),
        "bytes": len(data),
        "name": metadata["name"],
        "description": metadata["description"],
        "metadataDiagnostics": diagnostics,
        "bodyLines": len(body.splitlines()),
        "riskSummary": dict(Counter(item["severity"] for item in findings)),
        "findings": findings,
        "caveat": "Static findings are review prompts, not proof of safety or maliciousness. Read the complete document before deciding.",
    }


def review_markdown(review: dict[str, Any]) -> str:
    lines = [
        f"# Review: {review['name']}", "",
        review["description"] or "No description.", "",
        f"Path: `{review['path']}`",
        f"SHA-256: `{review['contentHash']}`",
        f"Size: {review['bytes']} bytes · body lines: {review['bodyLines']}",
        "", "## Static findings", "",
    ]
    if review["findings"]:
        for item in review["findings"]:
            lines.append(f"- **{item['severity']} / {item['rule']}** at line {item['line']}: `{item['excerpt']}`")
    else:
        lines.append("No configured risk pattern matched.")
    if review["metadataDiagnostics"]:
        lines.extend(["", "## Metadata diagnostics", ""])
        lines.extend(f"- {item}" for item in review["metadataDiagnostics"])
    lines.extend(["", f"> {review['caveat']}", ""])
    return "\n".join(lines)


def emit(content: str, output: Path | None) -> None:
    if output is None:
        sys.stdout.write(content)
        if not content.endswith("\n"):
            sys.stdout.write("\n")
        return
    output = output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{output.name}.", dir=str(output.parent))
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(content)
            if not content.endswith("\n"):
                handle.write("\n")
        os.replace(temporary, output)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=False) + "\n"


def add_root_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--root", action="append", type=Path, help="Skill root to scan; repeatable. Supplying one disables default roots.")
    parser.add_argument("--project", type=Path, default=Path.cwd(), help="Project root used to derive default project Skill roots.")


def selected_roots(args: argparse.Namespace) -> list[Path]:
    roots = [path.expanduser() for path in args.root] if args.root else default_roots(args.project)
    if args.root:
        home = Path.home().resolve()
        for root in roots:
            resolved = root.resolve()
            if resolved == Path(resolved.anchor) or resolved == home:
                raise SkillMeshError(f"scan root is too broad: {resolved}")
    return roots


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    scan = subparsers.add_parser("scan", help="Inventory local Agent Skills.")
    add_root_arguments(scan)
    scan.add_argument("--format", choices=("json", "markdown"), default="json")
    scan.add_argument("--output", type=Path)

    plan = subparsers.add_parser("plan", help="Map Skills to a workflow and build ordered routes.")
    add_root_arguments(plan)
    plan.add_argument("--workflow", type=Path, required=True)
    plan.add_argument("--decisions", type=Path)
    plan.add_argument("--target-agent")
    plan.add_argument("--top", type=int, default=3, choices=range(1, 11), metavar="1..10")
    plan.add_argument("--format", choices=("json", "markdown"), default="json")
    plan.add_argument("--output", type=Path)

    review = subparsers.add_parser("review", help="Review one exact Skill document.")
    review.add_argument("--skill", type=Path, required=True)
    review.add_argument("--format", choices=("json", "markdown"), default="markdown")
    review.add_argument("--output", type=Path)

    validate = subparsers.add_parser("validate-workflow", help="Validate workflow JSON structure.")
    validate.add_argument("--workflow", type=Path, required=True)
    validate.add_argument("--output", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "scan":
            inventory = scan_roots(selected_roots(args))
            emit(json_text(public_inventory(inventory)) if args.format == "json" else inventory_markdown(public_inventory(inventory)), args.output)
        elif args.command == "plan":
            workflow = load_json(args.workflow, "workflow")
            inventory = scan_roots(selected_roots(args))
            plan = build_plan(workflow, inventory, load_decisions(args.decisions), args.target_agent, args.top)
            emit(json_text(plan) if args.format == "json" else plan_markdown(plan), args.output)
        elif args.command == "review":
            review = review_skill(args.skill.expanduser())
            emit(json_text(review) if args.format == "json" else review_markdown(review), args.output)
        elif args.command == "validate-workflow":
            workflow = load_json(args.workflow, "workflow")
            errors = validate_workflow(workflow)
            result = {"valid": not errors, "errors": errors, "workflow": str(args.workflow.resolve())}
            emit(json_text(result), args.output)
            return 0 if not errors else 1
        return 0
    except SkillMeshError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
