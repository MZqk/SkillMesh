import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CatalogService } from "../lib/catalog-service.mjs";
import { compilePlaybookDraft } from "../lib/playbook-compiler.mjs";
import { loadWorkflowTemplate } from "../lib/matcher.mjs";
import { WorkflowStore } from "../lib/workflow-store.mjs";

test("keeps Skill bodies private unless one exact document is explicitly requested", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capability-atlas-catalog-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const skillDirectory = path.join(directory, "fixture-skill");
  const skillPath = path.join(skillDirectory, "SKILL.md");
  await fs.mkdir(skillDirectory);
  await fs.writeFile(skillPath, [
    "---",
    "name: fixture-private-skill",
    "description: A safe fixture for privacy tests.",
    "---",
    "PRIVATE_BODY_SENTINEL",
    "",
  ].join("\n"));
  const disabledDirectory = path.join(directory, "disabled-skill");
  await fs.mkdir(disabledDirectory);
  await fs.writeFile(path.join(disabledDirectory, "SKILL.md"), [
    "---",
    "name: disabled-workflow-helper",
    "description: Safe requirements workflow fixture.",
    "disable: true",
    "---",
    "DISABLED_PRIVATE_BODY",
    "",
  ].join("\n"));
  const store = new WorkflowStore({ filePath: path.join(directory, "workspace.json") });
  const service = new CatalogService({ store });
  service.resolvedRoots = () => [{
    path: directory,
    provider: "fixture",
    scope: "custom",
    label: "Fixture",
    stability: "test",
    sourceKind: "direct",
  }];

  const search = await service.searchSkills({ query: "fixture-private", refresh: true });
  const rawSearch = JSON.stringify(search);
  assert.equal(search.items.length, 1);
  assert.doesNotMatch(rawSearch, /PRIVATE_BODY_SENTINEL/);
  assert.doesNotMatch(rawSearch, /SKILL\.md/);

  const tokenSearch = await service.searchSkills({ query: "safe privacy" });
  assert.equal(tokenSearch.items.length, 1);
  const disabledSearch = await service.searchSkills({ query: "requirements workflow", enabled: false });
  assert.equal(disabledSearch.items.length, 1);
  assert.equal(disabledSearch.items[0].readiness, "disabled");

  const metadata = await service.getSkill(search.items[0].id);
  assert.equal("paths" in metadata, false);
  const explicit = await service.getSkillContent(search.items[0].id);
  assert.equal(explicit.untrustedContent, true);
  assert.match(explicit.content, /PRIVATE_BODY_SENTINEL/);
  assert.match(explicit.instruction, /untrusted/);

  await fs.appendFile(skillPath, "changed\n");
  await assert.rejects(service.getSkillContent(search.items[0].id), /skill-content-changed-refresh-required/);
});

test("detects, previews, and explicitly applies a template fingerprint migration", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capability-atlas-template-migration-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new WorkflowStore({ filePath: path.join(directory, "workspace.json") });
  const service = new CatalogService({ store, homeDirectory: directory, projectRoot: directory });
  service.resolvedRoots = () => [];
  const agent = { type: "agent", name: "fixture-agent", channel: "mcp" };
  const human = { type: "human", name: "fixture-user", channel: "web" };
  const template = await loadWorkflowTemplate();
  const workflow = await store.createWorkflow({
    goal: "迁移 Web 手册模板",
    scopeDescription: "旧手册缺少模板内容指纹。",
    nonGoals: ["不自动覆盖"],
    acceptanceCriteria: ["先预览差异"],
    stages: template.stages,
  }, agent);
  const brief = await store.createProjectBrief(workflow.id, {
    projectName: "迁移样例",
    problemStatement: "旧模板无法检测内容漂移。",
    targetUsers: ["维护者"],
    primaryOutcome: "显式迁移模板。",
    inScope: ["迁移预览"],
    outOfScope: ["自动确认"],
    constraints: ["保留旧版本"],
    successCriteria: ["迁移生成新草案"],
    targetPlatforms: ["Web"],
    preferredStack: ["Next.js App Router", "TypeScript", "PostgreSQL", "Playwright"],
  }, agent);
  const frozen = await store.freezeProjectBrief(workflow.id, { expectedRevision: brief.revision }, human);
  const legacyInput = await compilePlaybookDraft({ workflow, projectBrief: frozen });
  delete legacyInput.source.templateContentHash;
  const draft = await store.createPlaybook(workflow.id, legacyInput, agent);
  const confirmed = await store.confirmPlaybook(workflow.id, {
    expectedRevision: draft.revision,
    reviewedContentHash: draft.contentHash,
  }, human);
  await store.startPlaybookProgress(workflow.id, human);

  const status = await service.playbookTemplateStatus(workflow.id);
  assert.equal(status.migrationRequired, true);
  assert.deepEqual(status.reasons, ["template-fingerprint-missing"]);
  assert.equal(status.currentTemplate.contentHash, null);
  assert.equal(status.targetTemplate.contentHash.length, 64);
  await assert.rejects(service.generatePlaybookDraft(workflow.id, {
    briefVersion: 1,
    expectedRevision: confirmed.revision,
  }, agent), /playbook-template-migration-required/);

  const preview = await service.previewPlaybookTemplateMigration(workflow.id);
  assert.equal(preview.previewContentHash.length, 64);
  assert.equal(preview.previewReviewHash.length, 64);
  assert.equal(preview.diff.changes.some((item) => item.path === "source"), true);
  assert.equal(preview.impact.progressWouldBecomeStale, true);
  assert.equal(preview.impact.confirmedVersionPreserved, 1);
  await assert.rejects(service.migratePlaybookTemplateDraft(workflow.id, {
    expectedRevision: confirmed.revision,
    targetTemplateVersion: preview.targetTemplate.version,
    targetTemplateContentHash: preview.targetTemplate.contentHash,
    previewReviewHash: "stale-preview",
  }, agent), /playbook-template-preview-hash-required/);

  const migrated = await service.migratePlaybookTemplateDraft(workflow.id, {
    expectedRevision: confirmed.revision,
    targetTemplateVersion: preview.targetTemplate.version,
    targetTemplateContentHash: preview.targetTemplate.contentHash,
    previewReviewHash: preview.previewReviewHash,
  }, agent);
  assert.equal(migrated.status, "draft");
  assert.equal(migrated.baseConfirmationVersion, 1);
  assert.equal(migrated.verificationLevel, "agent-generated");
  assert.equal(migrated.source.templateContentHash, preview.targetTemplate.contentHash);
  assert.equal((await service.playbookTemplateStatus(workflow.id)).migrationRequired, false);
  assert.equal((await store.getPlaybookProgress(workflow.id)).staleSessions.length, 1);
  assert.equal((await store.getPlaybookVersion(workflow.id, 1)).snapshot.contentHash, confirmed.contentHash);
});
