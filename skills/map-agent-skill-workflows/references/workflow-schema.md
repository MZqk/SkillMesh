# Workflow schema

Use a task-specific JSON object with this shape:

```json
{
  "id": "regular-agent-skill-development",
  "name": "Regular Agent Skill development",
  "version": "1.0.0",
  "description": "Create and validate a reusable Agent Skill.",
  "stages": [
    {
      "id": "understand",
      "order": 1,
      "title": "Understand the Skill",
      "summary": "Define concrete trigger and usage examples.",
      "dependencies": [],
      "deliverables": ["Examples", "Scope"],
      "acceptanceGate": "The supported and unsupported cases are explicit.",
      "capabilities": [
        {
          "id": "skill-design",
          "label": "Agent Skill design",
          "required": true,
          "terms": ["skill creator", "create skill", "SKILL.md"],
          "acceptanceCriteria": ["Triggers and reusable resources are defined"]
        }
      ]
    }
  ]
}
```

Rules:

- Require non-empty `id`, `name`, `version`, and `stages`.
- Give every stage and capability a unique `id` using lowercase letters, digits, and hyphens.
- Order stages with `order`; dependencies must refer to existing stage IDs and must not self-reference.
- Set `required` explicitly when a capability is optional. The default is `true`.
- Add precise English and/or Chinese `terms` that a relevant Skill would actually contain. Avoid relying only on generic words such as “build,” “quality,” or “skill.”
- Define observable `deliverables` and an `acceptanceGate` for every stage.
- Keep the workflow specific to the requested outcome. Split a stage only when it has a distinct deliverable or decision gate.
- Validate with `python3 scripts/skillmesh.py validate-workflow --workflow <file>` before mapping.

Decision files use the Skill content hash as the key:

```json
{
  "decisions": {
    "<sha256>": {
      "reviewedBy": "agent | human",
      "capabilities": {
        "<capability-id>": {
          "decision": "confirmed | partial | excluded",
          "rationale": "Why the full document does or does not cover this capability"
        }
      }
    }
  }
}
```

Decisions are bound to both the whole candidate document hash and one workflow capability. If one Skill covers some capabilities but not others, confirm only the covered capability; use `partial` when its procedure covers only part of that capability. Do not inflate every lexical match to confirmed coverage.
