import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  listAgentTargets,
  resolveAgentTargets,
  safeSkillDirectoryName,
  sharedSkillRoot,
} from "./agent-targets.mjs";
import { buildInstallationPlan } from "./install-plan.mjs";
import { scanInstalledSkill } from "./security-scan.mjs";
import { normalizeActor, publicWorkflow } from "./workflow-model.mjs";
import { defaultDataDirectory, WorkflowConflictError } from "./workflow-store.mjs";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1_000;
const MAX_COMMAND_OUTPUT = 64 * 1024;

function isHuman(actor) {
  return normalizeActor(actor).type === "human";
}

async function lstat(targetPath) {
  return fs.lstat(targetPath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

async function realpath(targetPath) {
  return fs.realpath(targetPath).catch(() => "");
}

async function directoryEntries(targetPath) {
  return new Set(await fs.readdir(targetPath).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  }));
}

async function skillContentHash(skillDirectory) {
  const contents = await fs.readFile(path.join(skillDirectory, "SKILL.md"));
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function packageIsAllowed(packageId) {
  return /^[\w.-]+\/[\w.-]+(?:@[\w.-]+)?$/u.test(String(packageId || ""));
}

function provenanceCheck(item) {
  const issues = [];
  if (!packageIsAllowed(item.packageId)) issues.push("external-package-id-invalid");
  if (item.sourceUrl && !String(item.sourceUrl).startsWith("https://")) issues.push("external-source-must-use-https");
  if (!item.externalCandidateId) issues.push("external-candidate-provenance-missing");
  if (!/^[a-f0-9]{64}$/u.test(String(item.reviewedContentHash || ""))) issues.push("external-reviewed-content-missing");
  return issues;
}

function withReviewedContentMismatch(scan, item, installedHash) {
  const severityOrder = ["none", "low", "medium", "high", "critical"];
  const severity = severityOrder.indexOf(scan?.severity) > severityOrder.indexOf("high")
    ? scan.severity
    : "high";
  return {
    ...(scan || {}),
    status: "blocked",
    severity,
    findings: [{
      id: "reviewed-content-hash-mismatch",
      severity: "high",
      message: `安装内容指纹 ${installedHash || "missing"} 与已审阅指纹 ${item.reviewedContentHash} 不一致。`,
      file: "SKILL.md",
    }, ...(scan?.findings || [])],
    scannedAt: scan?.scannedAt || new Date().toISOString(),
  };
}

function abortError() {
  const error = new Error("installation-cancelled");
  error.name = "AbortError";
  return error;
}

export function runBoundedCommand({ command, args, cwd, env, signal, timeoutMs = COMMAND_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const append = (current, chunk) => `${current}${chunk.toString("utf8")}`.slice(-MAX_COMMAND_OUTPUT);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.once("close", (code, childSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      if (code !== 0) {
        const error = new Error(`skills-cli-failed:${code ?? childSignal ?? "unknown"}`);
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}

async function sizeBelow(rootPath) {
  let total = 0;
  async function visit(candidate) {
    const stats = await lstat(candidate);
    if (!stats) return;
    if (stats.isSymbolicLink() || stats.isFile()) {
      total += stats.size;
      return;
    }
    if (!stats.isDirectory()) return;
    for (const name of await fs.readdir(candidate)) await visit(path.join(candidate, name));
  }
  await visit(rootPath);
  return total;
}

function redactedPlan(plan) {
  const wrapper = publicWorkflow({ installationPlans: [plan] }, { redactSensitive: true });
  return wrapper.installationPlans[0];
}

export class InstallationManager {
  constructor({
    store,
    service,
    homeDirectory = process.env.CAPABILITY_ATLAS_HOME_DIR || os.homedir(),
    dataDirectory = defaultDataDirectory(),
    runner = runBoundedCommand,
    securityScanner = scanInstalledSkill,
  } = {}) {
    if (!store || !service) throw new Error("installation-manager-dependencies-required");
    this.store = store;
    this.service = service;
    this.homeDirectory = path.resolve(homeDirectory);
    this.dataDirectory = path.resolve(dataDirectory);
    this.installationDirectory = path.join(this.dataDirectory, "installations");
    this.journalDirectory = path.join(this.installationDirectory, "journals");
    this.snapshotDirectory = path.join(this.installationDirectory, "snapshots");
    this.quarantineDirectory = path.join(this.dataDirectory, "quarantine");
    this.lockPath = path.join(this.installationDirectory, "global-job.lock");
    this.repairPath = path.join(this.installationDirectory, "needs-repair.json");
    this.ownershipPath = path.join(this.installationDirectory, "ownership.json");
    this.runner = runner;
    this.securityScanner = securityScanner;
    this.currentJob = null;
    this.externalLock = false;
    this.ready = this.#initialize();
  }

  async #initialize() {
    await Promise.all([
      fs.mkdir(this.journalDirectory, { recursive: true, mode: 0o700 }),
      fs.mkdir(this.snapshotDirectory, { recursive: true, mode: 0o700 }),
      fs.mkdir(this.quarantineDirectory, { recursive: true, mode: 0o700 }),
    ]);
    await this.#pruneRetention();
    const lock = await lstat(this.lockPath);
    if (!lock) return;
    let owner = null;
    try {
      owner = JSON.parse(await fs.readFile(path.join(this.lockPath, "owner.json"), "utf8"));
    } catch {
      owner = null;
    }
    const alive = owner?.pid && (() => {
      try {
        process.kill(owner.pid, 0);
        return true;
      } catch {
        return false;
      }
    })();
    if (alive) {
      this.externalLock = true;
      return;
    }
    await fs.rm(this.lockPath, { recursive: true, force: true });
    await this.#writeRepairMarker({
      reason: "interrupted-job",
      jobId: owner?.jobId || null,
      workflowId: owner?.workflowId || null,
      planId: owner?.planId || null,
      residualPaths: [],
    });
    await this.#markRunningPlansInterrupted();
  }

  async #pruneRetention() {
    const cutoff = Date.now() - RETENTION_MS;
    for (const root of [this.journalDirectory, this.snapshotDirectory, this.quarantineDirectory]) {
      for (const name of await fs.readdir(root).catch(() => [])) {
        const candidate = path.join(root, name);
        const stats = await fs.lstat(candidate).catch(() => null);
        if (stats && stats.mtimeMs < cutoff) await fs.rm(candidate, { recursive: true, force: true });
      }
    }
  }

  async #markRunningPlansInterrupted() {
    const data = await this.store.read();
    for (const workflow of data.workflows || []) {
      if (!(workflow.installationPlans || []).some((plan) => ["queued", "running"].includes(plan.status))) continue;
      const plans = structuredClone(workflow.installationPlans);
      for (const plan of plans) {
        if (!["queued", "running"].includes(plan.status)) continue;
        plan.status = "interrupted";
        plan.execution.message = "进程中断；请检查残留后选择恢复、回滚或隔离。";
        plan.updatedAt = new Date().toISOString();
      }
      await this.store.updateWorkflow(workflow.id, {
        expectedRevision: workflow.revision,
        patch: { installationPlans: plans },
      }, { type: "system", name: "installation-recovery" }).catch(() => {});
    }
  }

  async #writeRepairMarker(value) {
    const temporary = `${this.repairPath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify({ ...value, createdAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, this.repairPath);
  }

  async #readRepairMarker() {
    try {
      return JSON.parse(await fs.readFile(this.repairPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async status({ redactSensitive = false } = {}) {
    await this.ready;
    if (this.externalLock && !await lstat(this.lockPath)) this.externalLock = false;
    const [targets, repair, storageBytes] = await Promise.all([
      listAgentTargets({ homeDirectory: this.homeDirectory }),
      this.#readRepairMarker(),
      sizeBelow(this.installationDirectory).then(async (size) => size + await sizeBelow(this.quarantineDirectory)),
    ]);
    const result = {
      sharedRoot: sharedSkillRoot(this.homeDirectory),
      targets,
      activeJob: this.currentJob ? {
        id: this.currentJob.id,
        workflowId: this.currentJob.workflowId,
        planId: this.currentJob.planId,
        cancelRequested: this.currentJob.controller.signal.aborted,
      } : null,
      lockedByAnotherProcess: this.externalLock,
      needsRepair: Boolean(repair),
      repair,
      retentionDays: 30,
      storageBytes,
    };
    if (redactSensitive) {
      delete result.sharedRoot;
      for (const target of result.targets) delete target.path;
      if (result.repair) delete result.repair.residualPaths;
    }
    return result;
  }

  #commandFor(item, targets) {
    if (item.type !== "external-install") return [];
    const args = ["-y", "skills", "add", item.packageId, "--global", "--yes"];
    args.push("--agent", ...targets.map((target) => target.skillsCliAgent));
    if (!String(item.packageId).slice(String(item.packageId).indexOf("/") + 1).includes("@") && item.name) {
      args.push("--skill", item.name);
    }
    return ["npx", ...args];
  }

  async #inspectConflict(item) {
    const canonical = await lstat(item.canonicalPath);
    if (canonical) {
      if (item.type === "external-install") {
        return { status: "different-content", resolution: "keep", renameTo: "", details: "共享目录已存在；默认保留并跳过。" };
      }
      const canonicalHash = await skillContentHash(item.canonicalPath).catch(() => "");
      if (canonicalHash && canonicalHash === item.contentHash) {
        return { status: "same-content", resolution: "keep", renameTo: "", details: "共享目录已有相同内容。" };
      }
      return { status: "different-content", resolution: "keep", renameTo: "", details: "共享目录存在同名不同内容。" };
    }
    for (const [agent, targetPath] of Object.entries(item.targetPaths || {})) {
      if (await lstat(targetPath)) {
        return { status: "target-conflict", resolution: "keep", renameTo: "", details: `${agent} 的目标位置已存在。` };
      }
    }
    return { status: "none", resolution: "keep", renameTo: "", details: "" };
  }

  async createPlan({ workflowId, expectedRevision, targetAgents }, actor) {
    await this.ready;
    const workflow = await this.store.getWorkflow(workflowId);
    if (workflow.revision !== expectedRevision) throw new WorkflowConflictError(workflow.revision);
    const assessment = await this.service.assessWorkflow(workflowId, { includePaths: true });
    const targets = resolveAgentTargets(targetAgents, { homeDirectory: this.homeDirectory });
    const plan = buildInstallationPlan({
      workflow,
      assessment,
      targetAgentIds: targets.map((target) => target.id),
      actor: normalizeActor(actor),
      homeDirectory: this.homeDirectory,
      basedOnRevision: workflow.revision + 1,
    });
    for (const item of plan.items) {
      item.conflict = await this.#inspectConflict(item);
      item.command = this.#commandFor(item, targets);
      if (item.type === "external-install"
        && (item.conflict.status === "different-content" || item.externalCandidateStatus === "installed")) {
        item.selected = false;
        item.status = "already-installed";
      }
    }
    const updated = await this.store.updateWorkflow(workflowId, {
      expectedRevision,
      patch: { installationPlans: [...(workflow.installationPlans || []), plan] },
    }, actor);
    return { workflow: updated, plan: updated.installationPlans.at(-1) };
  }

  async configurePlan({ workflowId, planId, expectedRevision, selectedItemIds, itemOptions = {} }, actor) {
    await this.ready;
    if (!isHuman(actor)) throw new Error("human-installation-approval-required");
    const workflow = await this.store.getWorkflow(workflowId);
    if (workflow.revision !== expectedRevision) throw new WorkflowConflictError(workflow.revision);
    const plans = structuredClone(workflow.installationPlans || []);
    const plan = plans.find((item) => item.id === planId);
    if (!plan) throw new Error("installation-plan-not-found");
    if (!["draft", "partial", "failed", "cancelled"].includes(plan.status)) throw new Error("installation-plan-not-configurable");
    const selected = new Set(selectedItemIds || []);
    for (const item of plan.items) {
      const options = itemOptions[item.id] || {};
      item.selected = selected.has(item.id);
      item.acknowledgements = [...new Set(Array.isArray(options.acknowledgements) ? options.acknowledgements : item.acknowledgements || [])];
      if (["keep", "replace", "rename"].includes(options.conflictResolution)) {
        item.conflict.resolution = options.conflictResolution;
      }
      if (item.type === "external-install" && item.conflict.resolution === "rename") {
        throw new Error("external-install-rename-unsupported");
      }
      if (item.conflict.resolution === "rename") {
        item.conflict.renameTo = safeSkillDirectoryName(options.renameTo, `${item.installName}-${item.id.slice(-6)}`);
      }
      item.reinstallLatest = item.type === "external-install" && options.reinstallLatest === true;
      if (["installed", "installed-warning", "quarantined"].includes(item.status)
        && !(item.type === "external-install" && item.reinstallLatest)) item.selected = false;
      if (item.type === "local-sync" && item.incompatibleAgents.length
        && item.acknowledgements.includes("compatibility-override")) item.eligible = true;
    }
    plan.status = "draft";
    plan.basedOnRevision = workflow.revision + 1;
    plan.updatedAt = new Date().toISOString();
    plan.updatedBy = normalizeActor(actor);
    const updated = await this.store.updateWorkflow(workflowId, {
      expectedRevision,
      patch: { installationPlans: plans },
    }, actor);
    return { workflow: updated, plan: updated.installationPlans.find((item) => item.id === planId) };
  }

  async #acquireJobLock(job) {
    await fs.mkdir(this.lockPath, { mode: 0o700 });
    await fs.writeFile(path.join(this.lockPath, "owner.json"), `${JSON.stringify({
      pid: process.pid,
      jobId: job.id,
      workflowId: job.workflowId,
      planId: job.planId,
      createdAt: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600 });
  }

  #validateExecution(plan) {
    const selected = plan.items.filter((item) => item.selected);
    if (!selected.length) throw new Error("installation-items-required");
    for (const item of selected) {
      if (!item.eligible) throw new Error(`installation-item-ineligible:${item.id}`);
      if (item.riskFlags.includes("external-target-unsupported")) throw new Error(`external-target-unsupported:${item.id}`);
      if (item.riskFlags.includes("pre-scan-visible") && !item.acknowledgements.includes("pre-scan-visible")) {
        throw new Error(`installation-risk-ack-required:${item.id}:pre-scan-visible`);
      }
      if (item.riskFlags.includes("compatibility-override-required")
        && !item.acknowledgements.includes("compatibility-override")) {
        throw new Error(`installation-risk-ack-required:${item.id}:compatibility-override`);
      }
      if (item.conflict.resolution === "replace" && !item.acknowledgements.includes("replace-existing")) {
        throw new Error(`installation-risk-ack-required:${item.id}:replace-existing`);
      }
    }
  }

  async executePlan({ workflowId, planId, expectedRevision }, actor) {
    await this.ready;
    if (this.externalLock && !await lstat(this.lockPath)) this.externalLock = false;
    if (!isHuman(actor)) throw new Error("human-installation-approval-required");
    if (this.currentJob || this.externalLock) throw new Error("installation-job-active");
    if (await this.#readRepairMarker()) throw new Error("installation-needs-repair");
    const workflow = await this.store.getWorkflow(workflowId);
    if (workflow.revision !== expectedRevision) throw new WorkflowConflictError(workflow.revision);
    const plan = (workflow.installationPlans || []).find((item) => item.id === planId);
    if (!plan) throw new Error("installation-plan-not-found");
    if (plan.basedOnRevision !== workflow.revision) throw new Error("installation-plan-stale");
    this.#validateExecution(plan);
    const job = {
      id: crypto.randomUUID(),
      workflowId,
      planId,
      controller: new AbortController(),
      createdPaths: [],
      snapshots: [],
      residualPaths: [],
      journalPath: path.join(this.journalDirectory, `${Date.now()}-${planId}.jsonl`),
    };
    try {
      await this.#acquireJobLock(job);
    } catch (error) {
      if (error.code === "EEXIST") throw new Error("installation-job-active");
      throw error;
    }
    this.currentJob = job;
    await this.#updatePlan(workflowId, planId, (current) => {
      current.status = "queued";
      current.execution.jobId = job.id;
      current.execution.journalPath = job.journalPath;
      current.execution.message = "等待受控安装事务启动。";
      for (const item of current.items) if (item.selected) item.status = "queued";
    });
    queueMicrotask(() => this.#runJob(job).catch(() => {}));
    return { jobId: job.id, status: "queued", workflowId, planId };
  }

  async #journal(job, type, details = {}) {
    await fs.appendFile(job.journalPath, `${JSON.stringify({
      type,
      jobId: job.id,
      createdAt: new Date().toISOString(),
      ...details,
    })}\n`, { mode: 0o600 });
  }

  async #updatePlan(workflowId, planId, mutate, attempts = 8) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const workflow = await this.store.getWorkflow(workflowId);
      const plans = structuredClone(workflow.installationPlans || []);
      const plan = plans.find((item) => item.id === planId);
      if (!plan) throw new Error("installation-plan-not-found");
      const extraPatch = mutate(plan, workflow) || {};
      if (["draft", "partial", "failed", "cancelled"].includes(plan.status)) {
        plan.basedOnRevision = workflow.revision + 1;
      }
      plan.updatedAt = new Date().toISOString();
      plan.updatedBy = { type: "system", name: "installation-manager", channel: "web" };
      try {
        return await this.store.updateWorkflow(workflowId, {
          expectedRevision: workflow.revision,
          patch: { installationPlans: plans, ...extraPatch },
        }, { type: "system", name: "installation-manager", channel: "web" });
      } catch (error) {
        if (!(error instanceof WorkflowConflictError) || attempt === attempts - 1) throw error;
      }
    }
    throw new Error("installation-plan-update-failed");
  }

  async #loadOwnership() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.ownershipPath, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  }

  async #markOwned(job, item, ownedPaths) {
    const ownership = await this.#loadOwnership();
    for (const ownedPath of ownedPaths) {
      ownership[ownedPath] = {
        jobId: job.id,
        workflowId: job.workflowId,
        planId: job.planId,
        itemId: item.id,
        createdAt: new Date().toISOString(),
      };
    }
    const temporary = `${this.ownershipPath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(ownership, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, this.ownershipPath);
  }

  async #snapshot(job, originalPath, itemId) {
    const stats = await lstat(originalPath);
    if (!stats) return null;
    const directory = path.join(this.snapshotDirectory, job.id);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const snapshotPath = path.join(directory, `${safeSkillDirectoryName(path.basename(originalPath))}-${crypto.randomUUID().slice(0, 8)}`);
    await fs.rename(originalPath, snapshotPath);
    job.snapshots.push({ originalPath, snapshotPath, itemId });
    await this.#journal(job, "snapshot-created", { itemId, originalPath, snapshotPath });
    return snapshotPath;
  }

  async #createSymlink(job, item, targetPath, sourcePath) {
    await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    // macOS exposes /tmp through /private/tmp, and scanners intentionally retain
    // real paths.  Resolve both parent directories before computing a relative
    // link so a lexical HOME alias cannot produce a dangling symlink.
    const targetParent = await fs.realpath(path.dirname(targetPath)).catch(() => path.dirname(targetPath));
    const sourceParent = await fs.realpath(path.dirname(sourcePath)).catch(() => path.dirname(sourcePath));
    const normalizedSource = path.join(sourceParent, path.basename(sourcePath));
    const relative = path.relative(targetParent, normalizedSource);
    await fs.symlink(relative || normalizedSource, targetPath, "dir");
    job.createdPaths.push({ path: targetPath, itemId: item.id });
    await this.#journal(job, "path-created", { itemId: item.id, path: targetPath, kind: "symlink" });
  }

  async #preparePathConflict(job, item, targetPath, expectedRealPath = "") {
    const stats = await lstat(targetPath);
    if (!stats) return "create";
    const existingRealPath = await realpath(targetPath);
    if (expectedRealPath && existingRealPath === await realpath(expectedRealPath)) return "same";
    if (item.conflict.resolution === "keep") return "keep";
    if (item.conflict.resolution === "replace") {
      await this.#snapshot(job, targetPath, item.id);
      return "create";
    }
    return "rename";
  }

  async #installLocal(job, item) {
    const sourceSkill = item.sourcePath;
    const sourceDirectory = path.dirname(sourceSkill);
    const currentHash = await skillContentHash(sourceDirectory).catch(() => "");
    if (!currentHash) throw new Error("local-skill-source-missing");
    if (currentHash !== item.contentHash) throw new Error("local-skill-content-changed");
    const installName = item.conflict.resolution === "rename" ? item.conflict.renameTo : item.installName;
    const canonicalPath = path.join(sharedSkillRoot(this.homeDirectory), installName);
    const action = await this.#preparePathConflict(job, item, canonicalPath, sourceDirectory);
    if (action === "keep") return { status: "skipped", canonicalPath, error: "同名内容已保留；未覆盖。" };
    if (action === "rename" && await lstat(canonicalPath)) throw new Error("renamed-install-path-conflict");
    if (action === "create") await this.#createSymlink(job, item, canonicalPath, sourceDirectory);
    const targetPaths = {};
    let targetConflicts = 0;
    for (const target of resolveAgentTargets(item.targetAgents, { homeDirectory: this.homeDirectory })) {
      const targetPath = path.join(target.path, installName);
      targetPaths[target.id] = targetPath;
      const targetAction = await this.#preparePathConflict(job, item, targetPath, canonicalPath);
      if (targetAction === "same") continue;
      if (targetAction === "keep") {
        targetConflicts += 1;
        continue;
      }
      if (targetAction === "rename" && await lstat(targetPath)) {
        targetConflicts += 1;
        continue;
      }
      await this.#createSymlink(job, item, targetPath, canonicalPath);
    }
    const scan = await this.securityScanner(canonicalPath);
    const result = await this.#applyScanPolicy(job, item, canonicalPath, targetPaths, scan);
    return {
      ...result,
      canonicalPath,
      targetPaths,
      installedContentHash: currentHash,
      error: targetConflicts ? `${targetConflicts} 个目标位置冲突并按“保留”跳过。` : "",
    };
  }

  async #installExternal(job, item) {
    const provenanceIssues = provenanceCheck(item);
    if (provenanceIssues.length) throw new Error(provenanceIssues.join(","));
    const targets = resolveAgentTargets(item.targetAgents, { homeDirectory: this.homeDirectory });
    const beforeShared = await directoryEntries(sharedSkillRoot(this.homeDirectory));
    const beforeTargets = new Map();
    for (const target of targets) beforeTargets.set(target.id, await directoryEntries(target.path));
    const expectedPath = path.join(sharedSkillRoot(this.homeDirectory), item.installName);
    if (await lstat(expectedPath)) {
      if (!item.reinstallLatest && item.conflict.resolution === "keep") {
        return { status: "already-installed", canonicalPath: expectedPath, targetPaths: item.targetPaths, error: "已安装；默认跳过。" };
      }
      if (item.conflict.resolution === "replace") await this.#snapshot(job, expectedPath, item.id);
    }
    if (job.controller.signal.aborted) throw abortError();
    const command = this.#commandFor(item, targets);
    await this.#journal(job, "command-started", { itemId: item.id, command });
    await this.runner({
      command: command[0],
      args: command.slice(1),
      cwd: this.installationDirectory,
      env: { ...process.env },
      homeDirectory: this.homeDirectory,
      signal: job.controller.signal,
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    await this.#journal(job, "command-completed", { itemId: item.id });
    const afterShared = await directoryEntries(sharedSkillRoot(this.homeDirectory));
    const createdNames = [...afterShared].filter((name) => !beforeShared.has(name));
    let canonicalPath = await lstat(expectedPath) ? expectedPath : "";
    if (!canonicalPath && createdNames.length === 1) canonicalPath = path.join(sharedSkillRoot(this.homeDirectory), createdNames[0]);
    if (!canonicalPath) {
      const matching = createdNames.find((name) => safeSkillDirectoryName(name) === item.installName);
      if (matching) canonicalPath = path.join(sharedSkillRoot(this.homeDirectory), matching);
    }
    if (!canonicalPath) throw new Error("external-install-not-rediscovered-in-shared-root");
    for (const name of createdNames) {
      const createdPath = path.join(sharedSkillRoot(this.homeDirectory), name);
      job.createdPaths.push({ path: createdPath, itemId: item.id });
    }
    const targetPaths = {};
    for (const target of targets) {
      const after = await directoryEntries(target.path);
      for (const name of [...after].filter((entry) => !beforeTargets.get(target.id).has(entry))) {
        const createdPath = path.join(target.path, name);
        job.createdPaths.push({ path: createdPath, itemId: item.id });
      }
      const installName = path.basename(canonicalPath);
      const targetPath = path.join(target.path, installName);
      targetPaths[target.id] = targetPath;
      if (!await lstat(targetPath)) await this.#createSymlink(job, item, targetPath, canonicalPath);
    }
    const installedHash = await skillContentHash(canonicalPath).catch(() => "");
    let scan = await this.securityScanner(canonicalPath);
    if (installedHash !== item.reviewedContentHash) {
      scan = withReviewedContentMismatch(scan, item, installedHash);
    }
    const result = await this.#applyScanPolicy(job, item, canonicalPath, targetPaths, scan);
    return {
      ...result,
      canonicalPath,
      targetPaths,
      installedContentHash: installedHash,
      error: result.error || "",
    };
  }

  async #applyScanPolicy(job, item, canonicalPath, targetPaths, scan) {
    if (!["high", "critical"].includes(scan.severity)) {
      return { status: scan.status === "warning" ? "installed-warning" : "installed", securityScan: scan };
    }
    const ownership = await this.#loadOwnership();
    for (const targetPath of Object.values(targetPaths)) {
      const created = job.createdPaths.some((entry) => entry.itemId === item.id && entry.path === targetPath);
      if (created || ownership[targetPath]?.itemId === item.id) await fs.rm(targetPath, { recursive: true, force: true });
    }
    const createdCanonical = job.createdPaths.some((entry) => entry.itemId === item.id && entry.path === canonicalPath);
    let quarantinePath = "";
    if (createdCanonical || ownership[canonicalPath]?.itemId === item.id) {
      quarantinePath = path.join(
        this.quarantineDirectory,
        `${Date.now()}-${safeSkillDirectoryName(path.basename(canonicalPath))}-${item.id.slice(-6)}`,
      );
      await fs.rename(canonicalPath, quarantinePath);
      await this.#journal(job, "item-quarantined", { itemId: item.id, canonicalPath, quarantinePath, severity: scan.severity });
    }
    return {
      status: "quarantined",
      securityScan: scan,
      quarantinePath,
      error: quarantinePath
        ? "高风险发现：已断开 Agent 链接并移入隔离区。"
        : "高风险发现：已断开本次创建的链接；原始非托管来源未被移动。",
    };
  }

  async #rollbackItem(job, itemId, createdStart, snapshotStart) {
    const residual = [];
    for (const entry of job.createdPaths.slice(createdStart).reverse()) {
      if (entry.itemId !== itemId) continue;
      try {
        await fs.rm(entry.path, { recursive: true, force: true });
      } catch {
        residual.push(entry.path);
      }
    }
    for (const snapshot of job.snapshots.slice(snapshotStart).reverse()) {
      if (snapshot.itemId !== itemId) continue;
      try {
        if (!await lstat(snapshot.originalPath) && await lstat(snapshot.snapshotPath)) {
          await fs.rename(snapshot.snapshotPath, snapshot.originalPath);
        }
      } catch {
        residual.push(snapshot.originalPath, snapshot.snapshotPath);
      }
    }
    job.residualPaths.push(...residual);
    return residual;
  }

  async #executeItem(job, item) {
    const createdStart = job.createdPaths.length;
    const snapshotStart = job.snapshots.length;
    await this.#journal(job, "item-started", { itemId: item.id, type: item.type });
    try {
      const result = item.type === "local-sync"
        ? await this.#installLocal(job, item)
        : await this.#installExternal(job, item);
      const owned = job.createdPaths.slice(createdStart).filter((entry) => entry.itemId === item.id).map((entry) => entry.path);
      if (owned.length) await this.#markOwned(job, item, owned);
      await this.#journal(job, "item-completed", { itemId: item.id, status: result.status });
      return result;
    } catch (error) {
      const residual = await this.#rollbackItem(job, item.id, createdStart, snapshotStart);
      await this.#journal(job, "item-failed", { itemId: item.id, error: error.message, residualPaths: residual });
      if (residual.length) return { status: "needs-repair", error: error.message, residualPaths: residual };
      if (error.name === "AbortError") throw error;
      return { status: "failed", error: error.message };
    }
  }

  async #rediscovery(job) {
    const inventory = await this.service.inventory({ refresh: true });
    await this.#updatePlan(job.workflowId, job.planId, (current) => {
      for (const item of current.items) {
        if (!["installed", "installed-warning", "already-installed"].includes(item.status)) continue;
        const matches = (inventory.skills || []).filter((skill) =>
          (item.installedContentHash && skill.contentHash === item.installedContentHash)
          || skill.path === path.join(item.canonicalPath, "SKILL.md")
          || Object.values(item.targetPaths || {}).some((targetPath) => skill.path === path.join(targetPath, "SKILL.md")));
        item.discovered = {
          found: matches.length > 0,
          providers: [...new Set(matches.map((skill) => skill.provider).filter(Boolean))],
          agents: [...new Set(matches.flatMap((skill) => skill.supportedAgents || []))],
          checkedAt: new Date().toISOString(),
        };
        if (!item.discovered.found && item.status !== "already-installed") {
          item.status = "failed";
          item.error = "文件写入完成，但重新扫描未发现该 Skill；未计为安装成功。";
        }
      }
    });
    const reassessment = [];
    const workflow = await this.store.getWorkflow(job.workflowId);
    const plan = workflow.installationPlans.find((item) => item.id === job.planId);
    for (const targetAgent of plan.targetAgents) {
      const assessment = await this.service.assessWorkflow(job.workflowId, {
        refresh: false,
        includePaths: false,
        targetAgent,
      });
      reassessment.push({
        targetAgent,
        matchScore: assessment.summary.matchScore,
        coverageRatio: assessment.summary.coverageRatio,
        evidencedCoverageRatio: assessment.summary.evidencedCoverageRatio ?? assessment.summary.coverageRatio,
        confirmedCoverageRatio: assessment.summary.confirmedCoverageRatio || 0,
        missingRequiredCapabilities: assessment.summary.missingRequiredCapabilities,
        unconfirmedRequiredCapabilities: assessment.summary.unconfirmedRequiredCapabilities || 0,
        assessedAt: new Date().toISOString(),
      });
    }
    return reassessment;
  }

  async #runJob(job) {
    let needsRepair = false;
    try {
      await this.#journal(job, "job-started");
      await this.#updatePlan(job.workflowId, job.planId, (plan) => {
        plan.status = "running";
        plan.execution.startedAt = new Date().toISOString();
        plan.execution.message = "正在逐项执行；每个 Skill 独立回滚。";
      });
      let workflow = await this.store.getWorkflow(job.workflowId);
      let plan = workflow.installationPlans.find((item) => item.id === job.planId);
      for (const planned of plan.items.filter((item) => item.selected)) {
        if (job.controller.signal.aborted) throw abortError();
        await this.#updatePlan(job.workflowId, job.planId, (current) => {
          const item = current.items.find((entry) => entry.id === planned.id);
          item.status = "running";
          item.startedAt = new Date().toISOString();
          item.error = "";
        });
        workflow = await this.store.getWorkflow(job.workflowId);
        plan = workflow.installationPlans.find((item) => item.id === job.planId);
        const item = plan.items.find((entry) => entry.id === planned.id);
        const result = await this.#executeItem(job, item);
        if (result.status === "needs-repair") needsRepair = true;
        await this.#updatePlan(job.workflowId, job.planId, (current) => {
          const target = current.items.find((entry) => entry.id === item.id);
          Object.assign(target, result, { completedAt: new Date().toISOString() });
          if (result.canonicalPath) target.canonicalPath = result.canonicalPath;
          if (result.targetPaths) target.targetPaths = result.targetPaths;
        });
      }
      const reassessment = needsRepair ? [] : await this.#rediscovery(job);
      await this.#updatePlan(job.workflowId, job.planId, (current, currentWorkflow) => {
        const selected = current.items.filter((item) => item.selected);
        const states = new Set(selected.map((item) => item.status));
        current.status = states.has("needs-repair")
          ? "needs-repair"
          : states.has("failed") || states.has("quarantined") || states.has("installed-warning") || states.has("skipped")
            ? "partial"
            : "completed";
        current.reassessment = reassessment;
        current.execution.completedAt = new Date().toISOString();
        current.execution.reloadPending = selected
          .filter((item) => ["installed", "installed-warning", "already-installed"].includes(item.status))
          .flatMap((item) => item.targetAgents);
        current.execution.reloadPending = [...new Set(current.execution.reloadPending)];
        current.execution.residualPaths = [...new Set(job.residualPaths)];
        current.execution.message = current.status === "completed"
          ? "安装与重新扫描完成；目标 Agent 需重新加载后才会发现新 Skill。"
          : current.status === "needs-repair"
            ? "清理未完整完成；已阻止后续安装。"
            : "部分项目需要处理；成功项目已保留。";
        const installedExternalIds = new Set(selected
          .filter((item) => item.type === "external-install" && ["installed", "installed-warning"].includes(item.status))
          .map((item) => item.externalCandidateId));
        for (const candidate of currentWorkflow.externalCandidates || []) {
          if (installedExternalIds.has(candidate.id)) candidate.status = "installed";
        }
        return { externalCandidates: currentWorkflow.externalCandidates || [] };
      });
      if (needsRepair) {
        await this.#writeRepairMarker({
          reason: "cleanup-failed",
          jobId: job.id,
          workflowId: job.workflowId,
          planId: job.planId,
          residualPaths: [...new Set(job.residualPaths)],
        });
      }
      await this.#journal(job, "job-completed", { needsRepair });
    } catch (error) {
      const cancelled = error.name === "AbortError" || job.controller.signal.aborted;
      const residual = [...new Set(job.residualPaths)];
      needsRepair = residual.length > 0;
      await this.#updatePlan(job.workflowId, job.planId, (plan) => {
        for (const item of plan.items) {
          if (item.selected && ["queued", "running"].includes(item.status)) item.status = needsRepair ? "needs-repair" : "cancelled";
        }
        const hasSuccess = plan.items.some((item) => ["installed", "installed-warning", "already-installed"].includes(item.status));
        plan.status = needsRepair ? "needs-repair" : hasSuccess ? "partial" : cancelled ? "cancelled" : "failed";
        plan.execution.completedAt = new Date().toISOString();
        plan.execution.residualPaths = [...new Set(residual)];
        plan.execution.message = needsRepair
          ? "取消或失败后的清理不完整；已阻止后续安装。"
          : cancelled ? "已终止子进程并清理本次创建的路径。" : error.message;
      }).catch(() => {});
      if (needsRepair) {
        await this.#writeRepairMarker({
          reason: "cleanup-failed",
          jobId: job.id,
          workflowId: job.workflowId,
          planId: job.planId,
          residualPaths: [...new Set(residual)],
        });
      }
      await this.#journal(job, "job-stopped", { cancelled, error: error.message, residualPaths: residual }).catch(() => {});
    } finally {
      await fs.rm(this.lockPath, { recursive: true, force: true });
      if (this.currentJob?.id === job.id) this.currentJob = null;
    }
  }

  async cancel({ jobId }, actor) {
    await this.ready;
    if (!isHuman(actor)) throw new Error("human-installation-approval-required");
    if (!this.currentJob || this.currentJob.id !== jobId) throw new Error("installation-job-not-found");
    this.currentJob.controller.abort();
    await this.#updatePlan(this.currentJob.workflowId, this.currentJob.planId, (plan) => {
      plan.execution.cancelRequestedAt = new Date().toISOString();
      plan.execution.message = "正在终止子进程并清理本次事务。";
    });
    return { jobId, status: "cancelling" };
  }

  async waitForIdle({ timeoutMs = 10_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (this.currentJob && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    if (this.currentJob) throw new Error("installation-wait-timeout");
  }

  async acknowledgeWarnings({ workflowId, planId, expectedRevision, itemIds }, actor) {
    await this.ready;
    if (!isHuman(actor)) throw new Error("human-installation-approval-required");
    const acknowledged = new Set(itemIds || []);
    const workflow = await this.store.getWorkflow(workflowId);
    if (workflow.revision !== expectedRevision) throw new WorkflowConflictError(workflow.revision);
    const plans = structuredClone(workflow.installationPlans || []);
    const plan = plans.find((item) => item.id === planId);
    if (!plan) throw new Error("installation-plan-not-found");
    for (const item of plan.items) {
      if (item.status === "installed-warning" && acknowledged.has(item.id)) {
        item.acknowledgements = [...new Set([...(item.acknowledgements || []), "security-warning-reviewed"] )];
        item.status = "installed";
      }
    }
    if (plan.items.filter((item) => item.selected).every((item) => ["installed", "already-installed"].includes(item.status))) {
      plan.status = "completed";
    }
    plan.updatedAt = new Date().toISOString();
    const updated = await this.store.updateWorkflow(workflowId, {
      expectedRevision,
      patch: { installationPlans: plans },
    }, actor);
    return { workflow: updated, plan: updated.installationPlans.find((item) => item.id === planId) };
  }

  async quarantineItem({ workflowId, planId, itemId, expectedRevision }, actor) {
    await this.ready;
    if (!isHuman(actor)) throw new Error("human-installation-approval-required");
    if (this.currentJob) throw new Error("installation-job-active");
    const workflow = await this.store.getWorkflow(workflowId);
    if (workflow.revision !== expectedRevision) throw new WorkflowConflictError(workflow.revision);
    const plans = structuredClone(workflow.installationPlans || []);
    const plan = plans.find((entry) => entry.id === planId);
    const item = plan?.items.find((entry) => entry.id === itemId);
    if (!item) throw new Error("installation-item-not-found");
    const ownership = await this.#loadOwnership();
    const ownedTargets = Object.values(item.targetPaths || {}).filter((targetPath) => ownership[targetPath]?.itemId === item.id);
    for (const targetPath of ownedTargets) await fs.rm(targetPath, { recursive: true, force: true });
    let quarantinePath = "";
    if (ownership[item.canonicalPath]?.itemId === item.id && await lstat(item.canonicalPath)) {
      quarantinePath = path.join(this.quarantineDirectory, `${Date.now()}-${item.installName}-${item.id.slice(-6)}`);
      await fs.rename(item.canonicalPath, quarantinePath);
    }
    item.status = "quarantined";
    item.quarantinePath = quarantinePath;
    item.error = "由用户移除：托管链接已断开，托管来源已移入隔离区；原始本地来源未删除。";
    item.completedAt = new Date().toISOString();
    plan.status = "partial";
    plan.basedOnRevision = workflow.revision + 1;
    plan.updatedAt = new Date().toISOString();
    const updated = await this.store.updateWorkflow(workflowId, {
      expectedRevision,
      patch: { installationPlans: plans },
    }, actor);
    this.service.inventoryCache.clear();
    return { workflow: updated, plan: updated.installationPlans.find((entry) => entry.id === planId) };
  }

  async resolveRepair({ action }, actor) {
    await this.ready;
    if (!isHuman(actor)) throw new Error("human-installation-approval-required");
    const marker = await this.#readRepairMarker();
    if (!marker) return { status: "clear" };
    if (!["accept-current", "rollback", "quarantine"].includes(action)) throw new Error("repair-action-invalid");
    if (action !== "accept-current" && (marker.residualPaths || []).length) {
      const ownership = await this.#loadOwnership();
      for (const residualPath of marker.residualPaths) {
        if (!ownership[residualPath]) continue;
        if (action === "rollback") await fs.rm(residualPath, { recursive: true, force: true });
        else if (await lstat(residualPath)) {
          const target = path.join(this.quarantineDirectory, `${Date.now()}-${safeSkillDirectoryName(path.basename(residualPath))}`);
          await fs.rename(residualPath, target);
        }
      }
    }
    if (marker.workflowId && marker.planId) {
      const workflow = await this.store.getWorkflow(marker.workflowId).catch(() => null);
      if (workflow) {
        const plans = structuredClone(workflow.installationPlans || []);
        const plan = plans.find((entry) => entry.id === marker.planId);
        if (plan) {
          plan.status = "partial";
          plan.basedOnRevision = workflow.revision + 1;
          plan.execution.residualPaths = [];
          plan.execution.message = `中断事务已人工处理：${action}。可重新选择失败项目后重试。`;
          for (const item of plan.items) {
            if (item.status === "needs-repair") item.status = action === "quarantine" ? "quarantined" : "failed";
          }
          await this.store.updateWorkflow(workflow.id, {
            expectedRevision: workflow.revision,
            patch: { installationPlans: plans },
          }, actor);
        }
      }
    }
    await fs.rm(this.repairPath, { force: true });
    this.externalLock = false;
    return { status: "resolved", action };
  }

  publicPlan(plan) {
    return redactedPlan(plan);
  }
}
