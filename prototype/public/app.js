import {
  DEFAULT_GOAL,
  activeMap,
  loadWorkspace,
  saveWorkspace,
  updateActiveMap,
} from "./workspace.js";
import { candidateActionLabels } from "./candidate-action-labels.js";
import {
  missingWorkflowConfirmationFields,
  parseWorkflowListInput,
  workflowConfirmationState,
} from "./workflow-confirmation.js";
import { createPlaybookUi } from "./playbook-ui.js";

const STATUS = {
  complete: { label: "已人工确认", short: "已确认" },
  partial: { label: "部分覆盖", short: "部分" },
  uncertain: { label: "需要确认", short: "待确认" },
  missing: { label: "能力缺失", short: "缺失" },
};

const ROOT_STABILITY = {
  documented: "公开文档",
  observed: "本机观察",
  "user-configured": "用户指定",
  "environment-configured": "环境变量",
};

const API_ERROR_MESSAGE = {
  "custom-roots-must-be-an-array": "自定义扫描目录格式无效",
  "too-many-custom-roots": "自定义扫描目录不能超过 20 个",
  "custom-root-too-broad": "为保护隐私，不能扫描磁盘根目录或整个主目录",
  "request-too-large": "请求内容超过 1 MB 限制",
  "workflow-revision-conflict": "工作流已被其他 Agent 更新，请重新载入后再提交",
  "workflow-not-found": "共享工作流不存在或已被移除",
  "project-id-required": "项目实例必须填写项目标识",
  "install-targets-required": "请至少选择一个目标 Agent",
  "installation-plan-stale": "工作流已经变化，请重新生成安装计划",
  "installation-job-active": "已有安装事务正在运行，请等待或取消后再试",
  "installation-needs-repair": "上次事务存在未处理残留，请先完成修复",
  "installation-items-required": "请至少选择一个可安装项目",
  "human-installation-approval-required": "安装写入只能由网页端人工确认",
  "ecosystem-catalog-invalid": "生态目录数据格式无效",
  "ecosystem-skill-not-recordable": "这份公开记录暂时不能转换为受控安装候选",
  "ecosystem-skill-preview-unavailable": "目录没有提供这份 Skill 的可验证原文路径",
  "ecosystem-skill-source-unsupported": "当前只支持审阅与目录仓库一致的 GitHub 原文",
  "ecosystem-skill-document-not-found": "上游仓库中没有找到目录映射的 Skill 原文",
  "ecosystem-skill-document-too-large": "Skill 原文超过 256 KB 审阅上限",
  "ecosystem-skill-document-not-text": "上游内容不是可审阅的 UTF-8 文本",
  "ecosystem-skill-document-timeout": "读取 Skill 原文超时，请稍后重试",
  "ecosystem-skill-document-rate-limited": "GitHub 匿名读取额度已用完，请在额度重置后重试",
  "ecosystem-skill-document-redirect": "上游原文请求发生了未允许的重定向",
  "ecosystem-item-not-found": "生态目录已更新，请刷新后重新选择",
  "ecosystem-group-not-found": "该功能组已从生态目录移除，请刷新后重新选择",
  "ecosystem-gap-required": "生态候选必须绑定到明确的阶段和能力缺口",
  "ecosystem-chain-skills-required": "组合链成员无效，请刷新后重新选择",
  "ecosystem-item-not-chain": "该目录记录已不再是组合链，请刷新后重新选择",
  "skill-kit-object-required": "Skill Kit 不是有效对象",
  "skill-kit-schema-unsupported": "Skill Kit 版本不受支持",
  "skill-kit-skills-required": "Skill Kit 必须包含 1–100 个 Skill",
  "skill-kit-skill-invalid": "Skill Kit 中存在缺少名称、类型或内容指纹的条目",
  "skill-kit-external-package-invalid": "Skill Kit 中的外部包标识无效",
  "skill-kit-duplicate-skill": "Skill Kit 中存在重复 Skill",
  "skill-kit-hash-required": "Skill Kit 缺少可验证的意图指纹",
  "skill-kit-hash-mismatch": "Skill Kit 内容与声明指纹不一致，可能已被修改",
  "skill-kit-plan-not-found": "当前工作流没有可导出的安装计划",
  "skill-kit-empty": "安装计划尚未选择任何可导出 Skill",
  "workflow-stage-not-found": "目标阶段已变化，请重新选择",
  "workflow-capability-not-found": "目标能力已变化，请重新选择",
};

const CAPABILITY_STATUS = {
  confirmed: "已确认",
  evidenced: "本机有证据",
  uncertain: "证据偏弱",
  missing: "需要补齐",
};

const CAPABILITY_RECOMMENDATION = {
  "create-or-find-skill": "建议新建或寻找 Skill",
  "find-external-or-create": "通过 find-skills 寻找或创建",
  "review-external-candidates": "审阅已记录的外部候选",
  "review-or-optimize": "建议审阅或优化候选",
  "human-review": "等待人工判断",
  "runtime-validate-and-review": "等待运行验证与人工判断",
  none: "",
};

const state = {
  workspace: loadWorkspace(localStorage),
  inventory: null,
  plan: null,
  selectedStageId: null,
  overrides: {},
  workflows: [],
  activeWorkflow: null,
  polling: false,
  busy: false,
  catalog: {
    mode: "local",
    selectedKey: null,
    limit: 100,
    ecosystem: {
      payload: null,
      loading: false,
      error: "",
      requestId: 0,
      cacheKey: "",
      filters: { category: "", source: "", chain: "", sort: "relevance" },
      comparison: {
        activeGroupId: "",
        cache: {},
        error: "",
        loadingGroupId: "",
        requestId: 0,
      },
      document: {
        itemId: "",
        skillName: "",
        cache: {},
        error: "",
        loadingKey: "",
        requestId: 0,
      },
    },
  },
  installation: { status: null, focusItemId: null, kitPreview: null, kitFileName: "" },
};

let playbookUi = null;

const elements = {
  workflowSelect: document.querySelector("#workflow-select"),
  workflowSelectionSource: document.querySelector("#workflow-selection-source"),
  workflowSelectionName: document.querySelector("#workflow-selection-name"),
  workflowSelectionMeta: document.querySelector("#workflow-selection-meta"),
  workflowBadge: document.querySelector("#workflow-badge"),
  workflowRevision: document.querySelector("#workflow-revision"),
  workflowHistory: document.querySelector("#workflow-history"),
  workflowConfirmationReadiness: document.querySelector("#workflow-confirmation-readiness"),
  editWorkflowDefinition: document.querySelector("#edit-workflow-definition-button"),
  confirmWorkflow: document.querySelector("#confirm-workflow-button"),
  workflowDefinitionDialog: document.querySelector("#workflow-definition-dialog"),
  workflowDefinitionForm: document.querySelector("#workflow-definition-form"),
  workflowDefinitionNote: document.querySelector("#workflow-definition-note"),
  workflowScopeDescription: document.querySelector("#workflow-scope-description"),
  workflowNonGoals: document.querySelector("#workflow-non-goals"),
  workflowAcceptanceCriteria: document.querySelector("#workflow-acceptance-criteria"),
  closeWorkflowDefinition: document.querySelector("#close-workflow-definition-button"),
  cancelWorkflowDefinition: document.querySelector("#cancel-workflow-definition-button"),
  installationPlanButton: document.querySelector("#installation-plan-button"),
  rescan: document.querySelector("#rescan-button"),
  exportJson: document.querySelector("#export-json"),
  exportMarkdown: document.querySelector("#export-markdown"),
  workspaceButton: document.querySelector("#workspace-button"),
  saveStatus: document.querySelector("#save-status"),
  metrics: document.querySelector("#inventory-metrics"),
  scanTime: document.querySelector("#scan-time"),
  roots: document.querySelector("#root-list"),
  subtitle: document.querySelector("#map-subtitle"),
  counter: document.querySelector("#coverage-counter"),
  assumptions: document.querySelector("#assumption-list"),
  assumptionCount: document.querySelector("#assumption-count"),
  stages: document.querySelector("#stage-list"),
  inspector: document.querySelector("#inspector-content"),
  toast: document.querySelector("#toast"),
  catalogButton: document.querySelector("#catalog-button"),
  catalogDialog: document.querySelector("#catalog-dialog"),
  catalogEyebrow: document.querySelector("#catalog-eyebrow"),
  catalogDescription: document.querySelector("#catalog-description"),
  catalogLocalTab: document.querySelector("#catalog-local-tab"),
  catalogEcosystemTab: document.querySelector("#catalog-ecosystem-tab"),
  catalogSourceNote: document.querySelector("#catalog-source-note"),
  catalogSearchLabel: document.querySelector("#catalog-search-label"),
  catalogSearch: document.querySelector("#catalog-search"),
  catalogShare: document.querySelector("#catalog-share"),
  catalogRefresh: document.querySelector("#catalog-refresh"),
  catalogLocalToolbar: document.querySelector("#catalog-local-toolbar"),
  catalogEcosystemToolbar: document.querySelector("#catalog-ecosystem-toolbar"),
  catalogProvider: document.querySelector("#catalog-provider"),
  catalogIssue: document.querySelector("#catalog-issue"),
  catalogView: document.querySelector("#catalog-view"),
  catalogEcosystemCategory: document.querySelector("#catalog-ecosystem-category"),
  catalogEcosystemSource: document.querySelector("#catalog-ecosystem-source"),
  catalogEcosystemChain: document.querySelector("#catalog-ecosystem-chain"),
  catalogEcosystemSort: document.querySelector("#catalog-ecosystem-sort"),
  catalogSummary: document.querySelector("#catalog-summary"),
  catalogList: document.querySelector("#catalog-list"),
  catalogDetail: document.querySelector("#catalog-detail"),
  catalogMore: document.querySelector("#catalog-more"),
  workspaceDialog: document.querySelector("#workspace-dialog"),
  savedMaps: document.querySelector("#saved-map-list"),
  customRoots: document.querySelector("#custom-roots"),
  saveRoots: document.querySelector("#save-roots-button"),
  backupWorkspace: document.querySelector("#backup-workspace-button"),
  restoreWorkspace: document.querySelector("#restore-workspace-input"),
  resetReviews: document.querySelector("#reset-reviews-button"),
  installationDialog: document.querySelector("#installation-dialog"),
  installationGlobalStatus: document.querySelector("#installation-global-status"),
  installationSharedRoot: document.querySelector("#installation-shared-root"),
  installationTargets: document.querySelector("#installation-targets"),
  createInstallationPlan: document.querySelector("#create-installation-plan"),
  skillKitExport: document.querySelector("#skill-kit-export-button"),
  skillKitImport: document.querySelector("#skill-kit-import-input"),
  installationReceipt: document.querySelector("#installation-receipt"),
  installationFooterNote: document.querySelector("#installation-footer-note"),
  saveInstallationPlan: document.querySelector("#save-installation-plan"),
  executeInstallationPlan: document.querySelector("#execute-installation-plan"),
  cancelInstallationJob: document.querySelector("#cancel-installation-job"),
};

function node(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.dataset) Object.assign(element.dataset, options.dataset);
  if (options.attributes) {
    for (const [key, value] of Object.entries(options.attributes)) element.setAttribute(key, value);
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child) element.append(child);
  }
  return element;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const rawMessage = detail.message || detail.error || `HTTP ${response.status}`;
    const error = new Error(API_ERROR_MESSAGE[rawMessage] || rawMessage);
    error.status = response.status;
    error.detail = detail;
    throw error;
  }
  return response;
}

function customRoots() {
  return state.workspace.customRoots || [];
}

function applyActiveMap() {
  const map = activeMap(state.workspace);
  state.overrides = map.overrides || {};
  state.selectedStageId = map.selectedStageId || null;
}

function workflowOverrides(workflow) {
  return Object.fromEntries(Object.entries(workflow?.reviews || {}).map(([stageId, reviews]) => [
    stageId,
    Object.fromEntries(Object.entries(reviews).map(([contentHash, review]) => [contentHash, review.decision])),
  ]));
}

function applyWorkflow(workflow) {
  if (state.activeWorkflow?.id && workflow?.id !== state.activeWorkflow.id) {
    state.installation.kitPreview = null;
    state.installation.kitFileName = "";
  }
  state.activeWorkflow = workflow;
  state.workspace.activeWorkflowId = workflow?.id || null;
  state.overrides = workflowOverrides(workflow);
  persistWorkspace({ silent: true });
  renderWorkflowPicker();
  renderWorkflowState();
  playbookUi?.setWorkflow(workflow);
}

let savedStatusTimer;
function markSaved(message = "已同步到本机服务") {
  clearTimeout(savedStatusTimer);
  elements.saveStatus.textContent = message;
  savedStatusTimer = setTimeout(() => {
    elements.saveStatus.textContent = "共享本机存储";
  }, 2200);
}

function persistWorkspace({ silent = false } = {}) {
  updateActiveMap(state.workspace, {
    goal: state.activeWorkflow?.goal || activeMap(state.workspace).goal || DEFAULT_GOAL,
    overrides: state.overrides,
    selectedStageId: state.selectedStageId,
  });
  state.workspace.activeWorkflowId = state.activeWorkflow?.id || state.workspace.activeWorkflowId || null;
  try {
    state.workspace = saveWorkspace(localStorage, state.workspace);
    state.overrides = activeMap(state.workspace).overrides;
    if (!silent) markSaved();
  } catch {
    elements.saveStatus.textContent = "浏览器未允许保存";
  }
}

function setBusy(value, message = "") {
  state.busy = value;
  for (const button of [
    elements.rescan,
    elements.exportJson,
    elements.exportMarkdown,
    elements.workspaceButton,
    elements.catalogButton,
    elements.editWorkflowDefinition,
    elements.installationPlanButton,
    elements.skillKitExport,
  ]) {
    button.disabled = value;
  }
  elements.workflowSelect.disabled = value || !state.workflows.length;
  renderWorkflowConfirmationControls();
  if (message) elements.subtitle.textContent = message;
}

let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 2600);
}

function handle(action) {
  return async (...args) => {
    try {
      await action(...args);
    } catch (error) {
      console.error(error);
      toast(`操作失败：${error.message}`);
      setBusy(false);
    }
  };
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "时间未知";
  }
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function renderInventory() {
  const { inventory } = state;
  if (!inventory) return;
  const stats = inventory.stats;
  const values = [stats.paths, stats.uniqueContent, stats.nameConflictGroups, stats.disabled || 0];
  [...elements.metrics.querySelectorAll("strong")].forEach((element, index) => {
    element.textContent = values[index].toLocaleString("zh-CN");
  });
  elements.scanTime.textContent = `${formatTime(inventory.generatedAt)} 扫描`;
  elements.roots.replaceChildren();
  for (const root of inventory.roots) {
    const marker = node("i");
    const label = node("span", { className: "root-label" }, [
      node("span", { text: root.label }),
      node("em", { text: ROOT_STABILITY[root.stability] || root.stability }),
    ]);
    const count = node("b", { text: root.available ? String(root.files) : "未发现" });
    const item = node("li", { className: root.available ? "available" : "" }, [marker, label, count]);
    item.title = `${root.path} · ${root.stability}`;
    elements.roots.append(item);
  }
  populateProviderFilter();
  if (elements.catalogDialog.open) renderCatalog();
}

function renderAssumptions() {
  elements.assumptions.replaceChildren();
  const assumptions = [
    ...(state.plan?.assumptions || []),
    ...((state.plan?.staleReviews || []).length
      ? [`${state.plan.staleReviews.length} 条历史人工判断所绑定的 Skill 内容已变化或不再存在，需要重新确认。`]
      : []),
  ];
  elements.assumptionCount.textContent = String(assumptions.length);
  for (const assumption of assumptions) elements.assumptions.append(node("li", { text: assumption }));
}

function renderCounter() {
  const capabilities = state.plan?.stages?.flatMap((stage) => stage.capabilityCoverage || []) || [];
  const values = ["confirmed", "evidenced", "uncertain", "missing"].map((status) =>
    capabilities.filter((capability) => capability.status === status).length);
  [...elements.counter.querySelectorAll("b")].forEach((element, index) => {
    element.textContent = String(values[index]);
  });
}

function workflowSourceLabel(workflow) {
  const referenceType = workflow?.reference?.referenceType;
  if (referenceType === "agent-draft") return "MCP Agent 草案";
  if (referenceType === "human-curated") return "专家参考流程";
  return workflow?.status === "confirmed" ? "人工确认工作流" : "共享工作流";
}

function renderWorkflowPicker() {
  const choices = [...state.workflows];
  if (state.activeWorkflow && !choices.some((workflow) => workflow.id === state.activeWorkflow.id)) {
    choices.unshift(state.activeWorkflow);
  }
  elements.workflowSelect.replaceChildren();
  if (!choices.length) {
    elements.workflowSelect.append(node("option", { text: "尚无可选择的工作流", attributes: { value: "" } }));
    elements.workflowSelect.disabled = true;
    elements.workflowSelectionSource.textContent = "等待 MCP";
    elements.workflowSelectionName.textContent = "尚未选择工作流";
    elements.workflowSelectionMeta.textContent = "让 AI Agent 通过 MCP 提交草案后，工作流会自动出现在这里。";
    return;
  }
  for (const workflow of choices) {
    const status = workflow.status === "confirmed" ? `已确认 v${workflow.confirmedVersion}` : "草案";
    const option = node("option", {
      text: `${workflow.goal} · ${status}`,
      attributes: { value: workflow.id },
    });
    option.selected = workflow.id === state.activeWorkflow?.id;
    elements.workflowSelect.append(option);
  }
  elements.workflowSelect.disabled = state.busy;
  const workflow = state.activeWorkflow;
  if (!workflow) {
    elements.workflowSelect.selectedIndex = -1;
    elements.workflowSelectionSource.textContent = "请选择";
    elements.workflowSelectionName.textContent = "从列表选择一份工作流";
    elements.workflowSelectionMeta.textContent = `本机共有 ${choices.length} 份可用工作流。`;
    return;
  }
  const scope = workflow.scope === "project" ? `项目 ${workflow.projectId}` : "全局";
  const status = workflow.status === "confirmed" ? `已确认 v${workflow.confirmedVersion}` : "待人工确认";
  const stageCount = workflow.stages?.length || 0;
  elements.workflowSelectionSource.textContent = `${workflowSourceLabel(workflow)} · ${workflow.reference?.name || "自定义流程"}`;
  elements.workflowSelectionName.textContent = workflow.goal;
  elements.workflowSelectionMeta.textContent = `${stageCount} 个阶段 · 修订 ${workflow.revision} · ${scope} · ${status}`;
}

function renderWorkflowState() {
  const workflow = state.activeWorkflow;
  if (!workflow) {
    elements.workflowBadge.textContent = "未连接";
    elements.workflowBadge.classList.remove("confirmed");
    elements.workflowRevision.textContent = "尚无共享工作流";
    elements.workflowHistory.textContent = "等待 MCP Agent 提交工作流草案";
    elements.confirmWorkflow.disabled = true;
    elements.editWorkflowDefinition.disabled = true;
    elements.installationPlanButton.disabled = true;
    renderWorkflowConfirmationControls();
    return;
  }
  const history = workflow.history || state.plan?.workflow?.history || [];
  const confirmed = workflow.status === "confirmed";
  elements.workflowBadge.textContent = confirmed ? `人工确认 v${workflow.confirmedVersion}` : "共享草案";
  elements.workflowBadge.classList.toggle("confirmed", confirmed);
  elements.workflowRevision.textContent = `修订 ${workflow.revision} · ${workflow.scope === "project" ? `项目 ${workflow.projectId}` : "全局模板"}`;
  elements.workflowHistory.textContent = history.length
    ? `保留 ${history.length} 个人工确认版本 · 最近更新 ${formatDate(workflow.updatedAt)}`
    : `尚无人工确认版本 · 最近更新 ${formatDate(workflow.updatedAt)}`;
  elements.installationPlanButton.disabled = state.busy;
  renderWorkflowConfirmationControls();
  const plan = workflow.installationPlans?.at(-1);
  elements.installationPlanButton.textContent = plan
    ? `安装计划 · ${installationStatusLabel(plan.status)}`
    : "安装计划";
}

function renderWorkflowConfirmationControls() {
  const workflow = state.activeWorkflow;
  const confirmation = workflowConfirmationState(workflow, { busy: state.busy });
  elements.editWorkflowDefinition.disabled = !confirmation.canEdit;
  elements.confirmWorkflow.disabled = !confirmation.canConfirm;
  elements.workflowConfirmationReadiness.classList.toggle("ready", confirmation.missing.length === 0 && Boolean(workflow));

  if (!workflow) {
    elements.workflowConfirmationReadiness.textContent = "等待选择工作流";
    elements.editWorkflowDefinition.textContent = "补齐确认信息";
    elements.confirmWorkflow.textContent = "人工确认当前版本";
    elements.confirmWorkflow.title = "请先选择工作流";
    return;
  }
  if (confirmation.confirmed) {
    elements.workflowConfirmationReadiness.textContent = "当前版本已人工确认";
    elements.editWorkflowDefinition.textContent = "修改确认信息";
    elements.confirmWorkflow.textContent = "当前版本已确认";
    elements.confirmWorkflow.title = "修改工作流后会生成可再次确认的新草案";
    return;
  }
  elements.editWorkflowDefinition.textContent = confirmation.missing.length ? "补齐确认信息" : "编辑确认信息";
  elements.confirmWorkflow.textContent = "人工确认当前版本";
  if (confirmation.missing.length) {
    const message = `确认前缺少：${confirmation.missing.join("、")}`;
    elements.workflowConfirmationReadiness.textContent = message;
    elements.confirmWorkflow.title = message;
  } else {
    elements.workflowConfirmationReadiness.textContent = "确认信息完整，可以保存人工版本";
    elements.confirmWorkflow.title = "";
  }
}

function openWorkflowDefinitionDialog() {
  const workflow = state.activeWorkflow;
  if (!workflow) throw new Error("尚无可编辑的共享工作流");
  elements.workflowScopeDescription.value = workflow.scopeDescription || "";
  elements.workflowNonGoals.value = (workflow.nonGoals || []).join("\n");
  elements.workflowAcceptanceCriteria.value = (workflow.acceptanceCriteria || []).join("\n");
  elements.workflowDefinitionNote.textContent = workflow.status === "confirmed"
    ? "保存修改会从当前人工版本创建新草案；原确认版本保持不变。"
    : "这三项会和阶段、能力项及 Skill 判断一起保存为不可变人工版本。";
  elements.workflowDefinitionDialog.showModal();
}

function closeWorkflowDefinitionDialog() {
  elements.workflowDefinitionDialog.close();
}

async function fetchWorkflowList() {
  const response = await api("/api/workflows?limit=100");
  const payload = await response.json();
  state.workflows = payload.items || [];
  renderWorkflowPicker();
  renderSavedMaps();
  return state.workflows;
}

async function openWorkflow(id, { assess = true, announce = false } = {}) {
  const workflow = await (await api(`/api/workflows/${encodeURIComponent(id)}`)).json();
  applyWorkflow(workflow);
  if (!state.selectedStageId || !workflow.stages.some((stage) => stage.id === state.selectedStageId)) {
    state.selectedStageId = workflow.stages[0]?.id || null;
  }
  if (assess) await generatePlan({ preserveSelection: true });
  if (elements.installationDialog.open) {
    await fetchInstallationStatus();
    renderInstallationDialog();
  }
  if (announce) toast("已打开共享工作流");
  return workflow;
}

async function pollWorkflowUpdates() {
  if (state.polling || state.busy) return;
  state.polling = true;
  try {
    const knownIds = new Set(state.workflows.map((workflow) => workflow.id));
    const workflows = await fetchWorkflowList();
    const added = workflows.find((workflow) => !knownIds.has(workflow.id));
    if (added) {
      await openWorkflow(added.id, { assess: true });
      toast("已打开 Agent 创建的新工作流草案");
      return;
    }
    if (!state.activeWorkflow) return;
    const latest = workflows.find((workflow) => workflow.id === state.activeWorkflow.id);
    if (latest && latest.revision !== state.activeWorkflow.revision) {
      const installationUpdate = elements.installationDialog.open
        || ["queued", "running"].includes(latest.installationPlans?.at(-1)?.status);
      await openWorkflow(latest.id, { assess: true });
      if (!installationUpdate) toast("已同步 Agent 提交的新修订");
    }
  } catch (error) {
    console.warn("workflow polling failed", error);
  } finally {
    state.polling = false;
  }
}

function selectStage(stageId, { scroll = false } = {}) {
  state.selectedStageId = stageId;
  persistWorkspace({ silent: true });
  renderStages();
  renderInspector();
  if (scroll && window.innerWidth < 1180) {
    document.querySelector(".evidence-inspector").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderStages() {
  if (!state.plan) return;
  elements.stages.replaceChildren();
  for (const stage of state.plan.stages) {
    const status = STATUS[stage.status];
    const card = node("button", {
      className: `stage-card${state.selectedStageId === stage.id ? " selected" : ""}`,
      dataset: { status: stage.status },
      attributes: { type: "button", "aria-pressed": String(state.selectedStageId === stage.id) },
    });
    card.addEventListener("click", () => selectStage(stage.id, { scroll: true }));
    card.append(node("span", { className: "stage-number", text: String(stage.order).padStart(2, "0") }));
    const copy = node("span");
    copy.append(
      node("span", { className: "stage-phase", text: stage.phase }),
      node("h3", { text: stage.title }),
      node("p", { text: stage.summary }),
    );
    card.append(copy);
    const result = node("span", { className: "stage-result" });
    result.append(
      node("span", { className: "status-pill", text: status.short }),
      node("small", { text: `${stage.coverage.matched}/${stage.coverage.total} 能力 · ${stage.candidates.length} 候选` }),
    );
    card.append(result);
    elements.stages.append(card);
  }
}

function list(items, className) {
  const container = node("ul", { className });
  for (const item of items) container.append(node("li", { text: item }));
  return container;
}

function copyPath(filePath) {
  copyText(filePath, "路径已复制");
}

function copyText(value, successMessage = "已复制") {
  navigator.clipboard.writeText(value)
    .then(() => toast(successMessage))
    .catch(() => toast("无法访问剪贴板，请手动复制"));
}

function resetCatalogScroll({ results = true, detail = true } = {}) {
  if (results) elements.catalogList.closest(".catalog-results").scrollTop = 0;
  if (detail) elements.catalogDetail.scrollTop = 0;
}

async function setDecision(stageId, candidateId, decision) {
  const current = state.overrides[stageId]?.[candidateId];
  const next = current === decision ? "unreviewed" : decision;
  if (state.activeWorkflow) {
    const workflow = await (await api(`/api/workflows/${encodeURIComponent(state.activeWorkflow.id)}/review`, {
      method: "POST",
      body: JSON.stringify({
        expectedRevision: state.activeWorkflow.revision,
        stageId,
        contentHash: candidateId,
        decision: next,
      }),
    })).json();
    applyWorkflow(workflow);
    await fetchWorkflowList();
    await generatePlan({ preserveSelection: true });
    toast(next === "confirmed" ? "已确认覆盖并写入共享历史" : next === "partial" ? "已标记为部分覆盖" : next === "excluded" ? "已排除候选" : "已撤销人工判断");
    return;
  }
  state.overrides[stageId] ||= {};
  if (next !== "unreviewed") state.overrides[stageId][candidateId] = next;
  else delete state.overrides[stageId][candidateId];
  if (!Object.keys(state.overrides[stageId]).length) delete state.overrides[stageId];
  persistWorkspace();
  await generatePlan({ preserveSelection: true });
  toast(next === "confirmed" ? "已确认匹配并保存" : next === "partial" ? "已标记为部分覆盖" : next === "excluded" ? "已排除候选并保存" : "已撤销人工判断");
}

async function resetStageDecisions(stageId) {
  if (state.activeWorkflow) {
    const reviews = structuredClone(state.activeWorkflow.reviews || {});
    delete reviews[stageId];
    const workflow = await (await api(`/api/workflows/${encodeURIComponent(state.activeWorkflow.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        expectedRevision: state.activeWorkflow.revision,
        patch: { reviews },
      }),
    })).json();
    applyWorkflow(workflow);
    await fetchWorkflowList();
    await generatePlan({ preserveSelection: true });
    toast("已重置本阶段的人工判断");
    return;
  }
  delete state.overrides[stageId];
  persistWorkspace();
  await generatePlan({ preserveSelection: true });
  toast("已重置本阶段的人工判断");
}

async function setExternalCandidateStatus(candidateId, status) {
  if (!state.activeWorkflow) throw new Error("请先选择工作流");
  const externalCandidates = structuredClone(state.activeWorkflow.externalCandidates || []);
  const candidate = externalCandidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error("外部候选不存在");
  candidate.status = status;
  candidate.updatedAt = new Date().toISOString();
  const workflow = await (await api(`/api/workflows/${encodeURIComponent(state.activeWorkflow.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      expectedRevision: state.activeWorkflow.revision,
      patch: { externalCandidates },
    }),
  })).json();
  applyWorkflow(workflow);
  await fetchWorkflowList();
  await generatePlan({ preserveSelection: true });
  toast(status === "accepted" ? "已接受为外部安装候选；仍需在安装计划中确认风险" : "已排除外部候选");
}

function openCatalogFor(contentHash) {
  state.catalog.mode = "local";
  state.catalog.selectedKey = contentHash;
  elements.catalogSearch.value = "";
  elements.catalogProvider.value = "";
  elements.catalogIssue.value = "";
  elements.catalogView.value = "canonical";
  state.catalog.limit = 100;
  resetCatalogScroll();
  syncCatalogUrl();
  renderCatalog();
  elements.catalogDialog.showModal();
}

function openEcosystemForGap(query) {
  state.catalog.mode = "ecosystem";
  resetEcosystemComparison();
  state.catalog.selectedKey = null;
  state.catalog.limit = 100;
  elements.catalogSearch.value = query || "";
  state.catalog.ecosystem.filters = { category: "", source: "", chain: "", sort: "relevance" };
  resetCatalogScroll();
  syncCatalogUrl();
  renderCatalog();
  if (!elements.catalogDialog.open) elements.catalogDialog.showModal();
  elements.catalogSearch.focus();
}

function candidateCard(stage, candidate) {
  const actionLabels = candidateActionLabels(
    candidate.name,
    candidate.decision,
    candidate.provider,
    candidate.scope,
  );
  const card = node("article", {
    className: `candidate-card${candidate.decision === "confirmed" ? " confirmed" : ""}`,
  });
  const heading = node("div", { className: "candidate-heading" });
  const nameBlock = node("div");
  nameBlock.append(
    node("h4", { text: candidate.name }),
    node("p", { className: "candidate-meta", text: `${candidate.provider} · ${candidate.scope}` }),
  );
  heading.append(nameBlock, node("span", {
    className: "candidate-score",
    text: `综合 ${Math.round(candidate.score * 100)}%`,
    attributes: { title: "可解释检索综合分，不代表执行成功率" },
  }));
  card.append(heading, node("p", { className: "candidate-description", text: candidate.description }));
  card.append(node("p", {
    className: "candidate-meta score-breakdown",
    text: `需求匹配 ${Math.round((candidate.fitScore || 0) * 100)} · 能力覆盖 ${Math.round((candidate.coverageScore || 0) * 100)} · 就绪 ${Math.round((candidate.readinessScore || 0) * 100)} · 质量 ${Math.round((candidate.qualityScore || 0) * 100)} · 证据置信 ${Math.round((candidate.confidence || 0) * 100)}`,
  }));

  const readiness = node("div", { className: "readiness-row" });
  readiness.append(
    node("span", {
      className: `readiness-badge${candidate.readiness === "human-verified" ? " verified" : ""}`,
      text: candidate.readiness === "human-verified" ? "人工验证可用" : candidate.readiness === "attention" ? "就绪度需关注" : "尚未运行验证",
    }),
    node("span", { text: candidate.readiness === "human-verified" ? "有绑定当前内容指纹的使用记录" : "静态匹配不等于运行成功" }),
  );
  card.append(readiness);

  const evidenceList = node("ul", { className: "evidence-list" });
  if (!candidate.evidence.length) {
    evidenceList.append(node("li", { text: "由人工确认保留，当前没有自动匹配证据。" }));
  }
  for (const evidence of candidate.evidence.slice(0, 3)) {
    const item = node("li");
    item.append(
      node("span", { className: `evidence-tag ${evidence.strength}`, text: evidence.strength === "strong" ? "强" : "弱" }),
      document.createTextNode(`${evidence.capability} · “${evidence.term}” 来自 ${evidence.field}`),
    );
    evidenceList.append(item);
  }
  card.append(evidenceList);

  if (candidate.warnings.length) card.append(list(candidate.warnings, "warning-list"));
  if (candidate.optimization?.length) card.append(list(candidate.optimization, "optimization-list"));
  for (const suggestion of candidate.agentSuggestions || []) {
    card.append(node("div", { className: "agent-suggestion" }, [
      node("span", { className: "agent-badge", text: suggestion.actor?.name || "AI Agent" }),
      node("span", { text: `${suggestion.recommendation} · ${suggestion.rationale}` }),
    ]));
  }
  const pathRow = node("div", { className: "path-row" });
  pathRow.append(node("code", { text: candidate.path }));
  const inspect = node("button", {
    className: "icon-button",
    text: "详情",
    attributes: { type: "button", "aria-label": actionLabels.inspect },
  });
  inspect.addEventListener("click", () => openCatalogFor(candidate.contentHash));
  const copy = node("button", {
    className: "icon-button",
    text: "复制",
    attributes: { type: "button", "aria-label": actionLabels.copy },
  });
  copy.addEventListener("click", () => copyPath(candidate.path));
  pathRow.append(inspect, copy);
  card.append(pathRow);

  const actions = node("div", { className: "candidate-actions" });
  const confirm = node("button", {
    className: `confirm${candidate.decision === "confirmed" ? " active" : ""}`,
    text: candidate.decision === "confirmed" ? "已确认" : "确认匹配",
    attributes: { type: "button", "aria-label": actionLabels.confirm },
  });
  confirm.addEventListener("click", handle(() => setDecision(stage.id, candidate.id, "confirmed")));
  const partial = node("button", {
    className: `confirm${candidate.decision === "partial" ? " active" : ""}`,
    text: candidate.decision === "partial" ? "部分覆盖" : "标记部分",
    attributes: { type: "button", "aria-label": actionLabels.partial },
  });
  partial.addEventListener("click", handle(() => setDecision(stage.id, candidate.id, "partial")));
  const exclude = node("button", {
    className: "exclude",
    text: "排除候选",
    attributes: { type: "button", "aria-label": actionLabels.exclude },
  });
  exclude.addEventListener("click", handle(() => setDecision(stage.id, candidate.id, "excluded")));
  const install = node("button", {
    className: "install-candidate",
    text: candidate.decision === "confirmed" ? "加入安装计划" : "确认后可安装",
    attributes: {
      type: "button",
      "aria-label": actionLabels.install,
      ...(candidate.decision === "confirmed" ? {} : { disabled: "", title: "先人工确认匹配，才能进入安装计划。" }),
    },
  });
  install.addEventListener("click", handle(() => openInstallationDialog({ contentHash: candidate.contentHash })));
  actions.append(confirm, partial, exclude, install);
  card.append(actions);
  return card;
}

function renderInspector() {
  if (!state.plan || !state.selectedStageId) return;
  const stage = state.plan.stages.find((item) => item.id === state.selectedStageId);
  if (!stage) return;
  elements.inspector.replaceChildren();

  const header = node("header", { className: "inspector-header" });
  header.append(node("p", { className: "eyebrow", text: `${String(stage.order).padStart(2, "0")} · ${stage.phase}` }));
  const titleRow = node("div", { className: "inspector-title-row" });
  titleRow.append(
    node("h2", { text: stage.title }),
    node("span", { className: "status-pill", text: STATUS[stage.status].label, dataset: { status: stage.status } }),
  );
  header.append(titleRow, node("p", { className: "inspector-description", text: stage.description }));
  const scoreSummary = node("div", { className: "stage-score-summary" });
  scoreSummary.append(
    node("span", { text: `匹配 ${stage.matchPercent ?? Math.round((stage.matchScore || 0) * 100)}%` }),
    node("span", { text: `覆盖 ${Math.round(stage.coverage.ratio * 100)}%` }),
    node("span", { text: `就绪 ${Math.round((stage.readinessScore || 0) * 100)}%` }),
    node("span", { text: `质量 ${Math.round((stage.qualityScore || 0) * 100)}%` }),
  );
  header.append(scoreSummary);
  const confidence = node("div", { className: "confidence-block" });
  const confidenceLabel = node("div", { className: "confidence-label" });
  confidenceLabel.append(node("span", { text: "证据置信度" }), node("b", { text: `${Math.round(stage.confidence * 100)}%` }));
  const track = node("div", { className: "confidence-track" });
  const fill = node("i");
  fill.style.width = `${Math.round(stage.confidence * 100)}%`;
  track.append(fill);
  confidence.append(confidenceLabel, track);
  header.append(confidence);
  elements.inspector.append(header, node("div", { className: "reason-box", text: stage.reason }));

  if (Object.keys(state.overrides[stage.id] || {}).length) {
    const reviewBar = node("div", { className: "review-bar" });
    reviewBar.append(node("span", { text: `已人工处理 ${Object.keys(state.overrides[stage.id]).length} 个候选` }));
    const reset = node("button", {
      className: "review-reset",
      text: "重置本阶段判断",
      attributes: { type: "button" },
    });
    reset.addEventListener("click", handle(() => resetStageDecisions(stage.id)));
    reviewBar.append(reset);
    elements.inspector.append(reviewBar);
  }

  const capabilities = node("section", { className: "inspector-section" });
  capabilities.append(node("h3", { text: "能力覆盖与缺口" }));
  const capabilityList = node("div", { className: "capability-list" });
  for (const capability of stage.capabilityCoverage) {
    const item = node("div", {
      className: "capability-item",
      dataset: { status: capability.status },
    });
    item.append(
      node("i", { attributes: { "aria-hidden": "true" } }),
      node("strong", { text: capability.label }),
      node("span", {
        text: `${CAPABILITY_STATUS[capability.status]}${capability.candidateCount ? ` · ${capability.candidateCount} 候选` : ""}${CAPABILITY_RECOMMENDATION[capability.recommendation] ? ` · ${CAPABILITY_RECOMMENDATION[capability.recommendation]}` : ""}${capability.agentSuggestions?.length ? ` · ${capability.agentSuggestions.length} 条 Agent 建议` : ""}`,
      }),
    );
    if (capability.status === "missing" && capability.gapQuery) {
      item.append(node("code", { text: `find-skills 查询：${capability.gapQuery}` }));
      const discover = node("button", {
        className: "capability-ecosystem-link",
        text: "在生态目录中查找候选 →",
        attributes: { type: "button" },
      });
      discover.addEventListener("click", () => openEcosystemForGap(capability.gapQuery));
      item.append(discover);
    }
    for (const external of capability.externalCandidates || []) {
      const externalCard = node("div", { className: "external-candidate" });
      externalCard.append(
        node("strong", { text: external.skillName || external.packageId || "外部 Skill 候选" }),
        node("span", { text: `${external.packageId || external.sourceUrl} · ${external.status || "suggested"}${external.installCount ? ` · ${external.installCount.toLocaleString("zh-CN")} installs` : ""}` }),
      );
      if (external.chain) {
        externalCard.append(node("span", {
          className: "external-chain-provenance",
          text: `组合链 ${String(external.chainPosition).padStart(2, "0")}/${String(external.chainLength).padStart(2, "0")} · ${external.catalogGroup || "目录组合"}`,
        }));
      }
      externalCard.append(node("small", { text: external.rationale || external.securityNotes || "尚未安装或运行验证" }));
      const externalActions = node("div", { className: "external-candidate-actions" });
      if (external.status === "suggested") {
        const accept = node("button", { text: "接受为安装候选", attributes: { type: "button" } });
        accept.addEventListener("click", handle(() => setExternalCandidateStatus(external.id, "accepted")));
        const reject = node("button", { text: "排除", attributes: { type: "button" } });
        reject.addEventListener("click", handle(() => setExternalCandidateStatus(external.id, "rejected")));
        externalActions.append(accept, reject);
      } else if (external.status === "accepted") {
        const add = node("button", { text: "加入安装计划", attributes: { type: "button" } });
        add.addEventListener("click", handle(() => openInstallationDialog({ externalCandidateId: external.id })));
        externalActions.append(add);
      }
      if (externalActions.childElementCount) externalCard.append(externalActions);
      item.append(externalCard);
    }
    if (capability.agentSuggestions?.length) {
      item.title = capability.agentSuggestions
        .map((suggestion) => `${suggestion.actor?.name || "AI Agent"}: ${suggestion.rationale}`)
        .join("\n");
    }
    capabilityList.append(item);
  }
  capabilities.append(capabilityList);
  elements.inspector.append(capabilities);

  const outputs = node("section", { className: "inspector-section" });
  outputs.append(node("h3", { text: "交付物" }), list(stage.deliverables, "deliverable-list"));
  elements.inspector.append(outputs);

  if (stage.dependencies?.length) {
    const dependencyTitles = stage.dependencies.map((dependency) =>
      state.plan.stages.find((item) => item.id === dependency)?.title || dependency);
    const dependencies = node("section", { className: "inspector-section" });
    dependencies.append(node("h3", { text: "前置依赖" }), list(dependencyTitles, "deliverable-list"));
    elements.inspector.append(dependencies);
  }

  const gate = node("section", { className: "inspector-section" });
  gate.append(node("h3", { text: "进入下一阶段前" }), node("div", { className: "gate-box", text: stage.acceptanceGate }));
  elements.inspector.append(gate);

  const questions = node("section", { className: "inspector-section" });
  questions.append(node("h3", { text: "渐进澄清" }), list(stage.questions, "question-list"));
  elements.inspector.append(questions);

  const candidatesSection = node("section", { className: "inspector-section" });
  candidatesSection.append(node("h3", { text: `本机候选 · ${stage.candidates.length}` }));
  if (!stage.candidates.length) {
    candidatesSection.append(node("div", {
      className: "no-candidates",
      text: "当前没有本机候选。你可以从缺失能力直接进入生态目录，或让连接的 Agent 调用 find_external_skills；系统不会自动安装或执行外部 Skill。",
    }));
  } else {
    const stack = node("div", { className: "candidate-stack" });
    for (const candidate of stage.candidates) stack.append(candidateCard(stage, candidate));
    candidatesSection.append(stack);
  }
  elements.inspector.append(candidatesSection);
}

function skillPreference(skill) {
  const scope = { project: 5, user: 4, custom: 3, "plugin-cache": 2, internal: 1 }[skill.scope] || 0;
  return (skill.enabled === false ? -100 : 0)
    + (skill.sourceKind === "direct" ? 20 : 0)
    + scope
    + (skill.metadataStatus === "complete" ? 1 : 0);
}

function canonicalEntries() {
  const byContent = new Map();
  for (const skill of state.inventory?.skills || []) {
    if (!byContent.has(skill.contentHash)) byContent.set(skill.contentHash, []);
    byContent.get(skill.contentHash).push(skill);
  }
  return [...byContent.entries()].map(([key, copies]) => ({
    key,
    copies: copies.sort((left, right) => skillPreference(right) - skillPreference(left) || left.path.localeCompare(right.path)),
    skill: copies[0],
  }));
}

function pathEntries() {
  return (state.inventory?.skills || []).map((skill) => ({ key: skill.id, copies: [skill], skill }));
}

function issueFlags(entry) {
  const { skill, copies } = entry;
  const flags = [];
  if (skill.identity?.nameConflict) flags.push({ id: "conflict", label: "同名异构" });
  if (copies.length > 1 || skill.identity?.duplicateContent) flags.push({ id: "duplicate", label: `${Math.max(copies.length, skill.identity?.contentCopies || 1)} 个副本` });
  if (skill.metadataStatus === "incomplete") flags.push({ id: "incomplete", label: "元数据不完整" });
  if (skill.sourceKind === "derived") flags.push({ id: "derived", label: "缓存/派生" });
  if (skill.enabled === false) flags.push({ id: "disabled", label: "已禁用" });
  return flags;
}

function normalizedSearch(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function filteredCatalogEntries() {
  const query = normalizedSearch(elements.catalogSearch.value);
  const queryTerms = query.split(" ").filter(Boolean);
  const provider = elements.catalogProvider.value;
  const issue = elements.catalogIssue.value;
  const source = elements.catalogView.value === "paths" ? pathEntries() : canonicalEntries();
  return source
    .filter((entry) => !provider || entry.copies.some((copy) => copy.provider === provider))
    .filter((entry) => !issue || issueFlags(entry).some((flag) => flag.id === issue))
    .filter((entry) => {
      if (!queryTerms.length) return true;
      const corpus = normalizedSearch([
        entry.skill.name,
        entry.skill.description,
        entry.skill.provider,
        entry.skill.scope,
        entry.skill.packageId,
        ...(entry.skill.supportedAgents || []),
        ...(entry.skill.allowedTools || []),
        ...(entry.skill.triggers || []),
        ...(entry.skill.keywords || []),
        ...entry.copies.map((copy) => copy.path),
      ].join(" "));
      return queryTerms.every((term) => corpus.includes(term));
    })
    .sort((left, right) => left.skill.name.localeCompare(right.skill.name) || left.skill.path.localeCompare(right.skill.path));
}

function populateProviderFilter() {
  if (!state.inventory) return;
  const selected = elements.catalogProvider.value;
  const options = [node("option", { text: "全部生态", attributes: { value: "" } })];
  for (const provider of Object.keys(state.inventory.stats.providers).sort()) {
    options.push(node("option", {
      text: `${provider} · ${state.inventory.stats.providers[provider]}`,
      attributes: { value: provider },
    }));
  }
  elements.catalogProvider.replaceChildren(...options);
  if ([...elements.catalogProvider.options].some((option) => option.value === selected)) {
    elements.catalogProvider.value = selected;
  }
}

function renderLocalCatalogList(entries) {
  const visible = entries.slice(0, state.catalog.limit);
  if (!entries.some((entry) => entry.key === state.catalog.selectedKey)) {
    state.catalog.selectedKey = visible[0]?.key || null;
  }
  elements.catalogList.replaceChildren();
  if (!visible.length) {
    elements.catalogList.append(node("div", {
      className: "catalog-empty",
      children: [],
    }, [node("h3", { text: "没有匹配的 Skill" }), node("p", { text: "调整搜索词或筛选条件。" })]));
  }
  for (const entry of visible) {
    const item = node("button", {
      className: `catalog-item${entry.key === state.catalog.selectedKey ? " selected" : ""}`,
      attributes: { type: "button", "aria-pressed": String(entry.key === state.catalog.selectedKey) },
    });
    item.append(
      node("strong", { text: entry.skill.name }),
      node("small", { text: `${entry.skill.provider} · ${entry.skill.scope}` }),
      node("p", { text: entry.skill.description || "未提供 description；需要打开来源文件后人工判断作用。" }),
    );
    const flags = node("span", { className: "catalog-flags" });
    for (const flag of issueFlags(entry)) flags.append(node("span", { className: "catalog-flag", text: flag.label }));
    if (flags.childElementCount) item.append(flags);
    item.addEventListener("click", () => {
      state.catalog.selectedKey = entry.key;
      renderLocalCatalogList(entries);
      renderLocalCatalogDetail(entry);
      if (window.innerWidth < 820) elements.catalogDetail.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    elements.catalogList.append(item);
  }
  elements.catalogMore.hidden = visible.length >= entries.length;
}

function specimenFact(label, value, { code = false } = {}) {
  const fact = node("div", { className: "specimen-fact" });
  fact.append(node("span", { text: label }), node(code ? "code" : "strong", { text: value || "未声明" }));
  fact.title = value || "未声明";
  return fact;
}

function workflowUses(contentHash) {
  return (state.plan?.stages || []).flatMap((stage) =>
    stage.candidates.some((candidate) => candidate.contentHash === contentHash)
      ? [{ title: stage.title, status: STATUS[stage.status].short }]
      : [],
  );
}

function renderLocalCatalogDetail(entry) {
  elements.catalogDetail.replaceChildren();
  if (!entry) {
    elements.catalogDetail.append(node("div", { className: "catalog-empty" }, [
      node("span", { text: "⌖" }),
      node("h3", { text: "选择一份 Skill" }),
      node("p", { text: "这里会解释它做什么、来自哪里，以及为什么需要关注。" }),
    ]));
    return;
  }
  const { skill, copies } = entry;
  const heading = node("header", { className: "specimen-heading" });
  heading.append(
    node("p", {
      className: "eyebrow",
      text: `${skill.provider} · ${skill.scope} · ${skill.sourceKind} · ${ROOT_STABILITY[skill.rootStability] || skill.rootStability}`,
    }),
    node("h3", { text: skill.name }),
    node("p", { text: skill.description || "这份 Skill 没有 description，作用暂时无法从标准元数据可靠判断。" }),
  );
  const flags = node("div", { className: "catalog-flags" });
  for (const flag of issueFlags(entry)) flags.append(node("span", { className: "catalog-flag", text: flag.label }));
  if (flags.childElementCount) heading.append(flags);
  elements.catalogDetail.append(heading);

  const facts = node("div", { className: "specimen-grid" });
  facts.append(
    specimenFact("内容指纹", skill.contentHash.slice(0, 16), { code: true }),
    specimenFact("文件大小", formatBytes(skill.bytes)),
    specimenFact("版本", skill.version),
    specimenFact("许可证", skill.license),
    specimenFact("修改时间", formatDate(skill.modifiedAt)),
    specimenFact("元数据", skill.metadataStatus === "complete" ? "完整" : "需要补齐"),
    specimenFact("启用状态", skill.enabled === false ? `已禁用${skill.disabledReason ? ` · ${skill.disabledReason}` : ""}` : "已启用"),
    specimenFact("兼容 Agent", (skill.supportedAgents || []).join(", ") || "继承来源"),
    specimenFact("允许工具", (skill.allowedTools || []).join(", ") || "未声明"),
    specimenFact("来源包", skill.packageId || "直接安装/未声明"),
  );
  elements.catalogDetail.append(facts);

  const usage = workflowUses(skill.contentHash);
  const usageSection = node("section", { className: "specimen-section" });
  usageSection.append(node("h4", { text: "当前地图中的位置" }));
  usageSection.append(usage.length
    ? list(usage.map((item) => `${item.title} · ${item.status}`), "")
    : node("p", { className: "muted", text: "未进入当前地图前五名候选；这不等于 Skill 无用。" }));
  elements.catalogDetail.append(usageSection);

  const sourceSection = node("section", { className: "specimen-section" });
  sourceSection.append(node("h4", { text: `本机来源路径 · ${copies.length}` }));
  for (const copy of copies) {
    const pathRow = node("div", { className: "specimen-path" });
    const source = node("div");
    source.append(
      node("small", {
        text: `${copy.rootLabel} · ${ROOT_STABILITY[copy.rootStability] || copy.rootStability}`,
      }),
      node("code", { text: copy.path }),
    );
    pathRow.append(source);
    const copyButton = node("button", { className: "icon-button", text: "复制", attributes: { type: "button" } });
    copyButton.addEventListener("click", () => copyPath(copy.path));
    pathRow.append(copyButton);
    sourceSection.append(pathRow);
  }
  elements.catalogDetail.append(sourceSection);

  const diagnostics = [...new Set(copies.flatMap((copy) => copy.diagnostics || []))];
  if (diagnostics.length || skill.identity?.nameConflict) {
    const diagnosticsSection = node("section", { className: "specimen-section" });
    diagnosticsSection.append(
      node("h4", { text: "需要关注" }),
      list([
        ...(skill.identity?.nameConflict ? [`同名存在 ${skill.identity.nameVariants} 份不同内容，不能按名称自动合并。`] : []),
        ...diagnostics.map((item) => `解析诊断：${item}`),
      ], ""),
    );
    elements.catalogDetail.append(diagnosticsSection);
  }
}

function renderLocalCatalog() {
  if (!state.inventory) return;
  const entries = filteredCatalogEntries();
  const sourceCount = elements.catalogView.value === "paths"
    ? state.inventory.stats.paths
    : state.inventory.stats.uniqueContent;
  elements.catalogSummary.textContent = `显示 ${Math.min(entries.length, state.catalog.limit).toLocaleString("zh-CN")} / ${entries.length.toLocaleString("zh-CN")} 项 · 当前视图共 ${sourceCount.toLocaleString("zh-CN")} 项`;
  renderLocalCatalogList(entries);
  renderLocalCatalogDetail(entries.find((entry) => entry.key === state.catalog.selectedKey) || entries[0]);
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function ecosystemFilters() {
  return state.catalog.ecosystem.filters;
}

function resetEcosystemComparison({ clearCache = false } = {}) {
  const comparison = state.catalog.ecosystem.comparison;
  comparison.activeGroupId = "";
  comparison.error = "";
  comparison.loadingGroupId = "";
  comparison.requestId += 1;
  if (clearCache) comparison.cache = {};
}

function resetEcosystemDocument({ clearCache = false } = {}) {
  const documentReview = state.catalog.ecosystem.document;
  documentReview.itemId = "";
  documentReview.skillName = "";
  documentReview.error = "";
  documentReview.loadingKey = "";
  documentReview.requestId += 1;
  if (clearCache) documentReview.cache = {};
}

function ecosystemQueryParams({ refresh = false } = {}) {
  const filters = ecosystemFilters();
  const params = new URLSearchParams();
  if (elements.catalogSearch.value.trim()) params.set("query", elements.catalogSearch.value.trim());
  if (filters.category) params.set("category", filters.category);
  if (filters.source) params.set("source", filters.source);
  if (filters.chain) params.set("chain", filters.chain);
  if (filters.sort !== "relevance") params.set("sort", filters.sort);
  params.set("limit", String(state.catalog.limit));
  if (refresh) params.set("refresh", "1");
  return params;
}

function syncCatalogUrl() {
  const url = new URL(window.location.href);
  for (const key of ["catalog", "q", "category", "source", "chain", "sort"]) url.searchParams.delete(key);
  url.searchParams.set("catalog", state.catalog.mode);
  if (elements.catalogSearch.value.trim()) url.searchParams.set("q", elements.catalogSearch.value.trim());
  if (state.catalog.mode === "ecosystem") {
    const filters = ecosystemFilters();
    if (filters.category) url.searchParams.set("category", filters.category);
    if (filters.source) url.searchParams.set("source", filters.source);
    if (filters.chain) url.searchParams.set("chain", filters.chain);
    if (filters.sort !== "relevance") url.searchParams.set("sort", filters.sort);
  }
  window.history.replaceState(null, "", url);
  return url;
}

function clearCatalogUrl() {
  const url = new URL(window.location.href);
  for (const key of ["catalog", "q", "category", "source", "chain", "sort"]) url.searchParams.delete(key);
  window.history.replaceState(null, "", url);
}

function restoreCatalogFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("catalog");
  if (!mode || !["local", "ecosystem"].includes(mode)) return false;
  state.catalog.mode = mode;
  elements.catalogSearch.value = params.get("q") || "";
  const filters = ecosystemFilters();
  filters.category = params.get("category") || "";
  filters.source = params.get("source") || "";
  filters.chain = params.get("chain") === "chained" ? "chained" : "";
  filters.sort = ["relevance", "popular", "recent"].includes(params.get("sort")) ? params.get("sort") : "relevance";
  return true;
}

function applyCatalogMode() {
  const ecosystem = state.catalog.mode === "ecosystem";
  elements.catalogLocalTab.setAttribute("aria-selected", String(!ecosystem));
  elements.catalogEcosystemTab.setAttribute("aria-selected", String(ecosystem));
  elements.catalogLocalTab.tabIndex = ecosystem ? -1 : 0;
  elements.catalogEcosystemTab.tabIndex = ecosystem ? 0 : -1;
  elements.catalogLocalToolbar.hidden = ecosystem;
  elements.catalogEcosystemToolbar.hidden = !ecosystem;
  elements.catalogRefresh.hidden = !ecosystem;
  elements.catalogEyebrow.textContent = ecosystem ? "Ecosystem discovery index" : "Local inventory fieldbook";
  elements.catalogDescription.textContent = ecosystem
    ? "从 Skills Atlas 公开元数据发现候选；所有记录仍需人工审阅，目录不会触发下载、安装或执行。"
    : "查看本机每份 Skill 的作用、来源、副本和冲突；正文不会发送到浏览器。";
  elements.catalogSearchLabel.textContent = ecosystem ? "搜索能力、Skill、用例或来源" : "搜索名称、作用或路径";
  elements.catalogSourceNote.textContent = ecosystem
    ? "公开目录是发现线索，不是本机证据；候选必须绑定到明确缺口。"
    : "本机内容按指纹去重；正文不进入浏览器。";
}

function setCatalogMode(mode) {
  if (!["local", "ecosystem"].includes(mode) || mode === state.catalog.mode) return;
  state.catalog.mode = mode;
  resetEcosystemComparison();
  resetEcosystemDocument();
  state.catalog.selectedKey = null;
  state.catalog.limit = 100;
  resetCatalogScroll();
  syncCatalogUrl();
  renderCatalog();
  elements.catalogSearch.focus();
}

function populateEcosystemFacets(payload) {
  const filters = ecosystemFilters();
  const categoryOptions = [node("option", { text: "全部大类", attributes: { value: "" } })];
  for (const category of payload.facets?.categories || []) {
    categoryOptions.push(node("option", { text: category.label, attributes: { value: category.id } }));
  }
  elements.catalogEcosystemCategory.replaceChildren(...categoryOptions);
  elements.catalogEcosystemCategory.value = [...elements.catalogEcosystemCategory.options]
    .some((option) => option.value === filters.category) ? filters.category : "";
  filters.category = elements.catalogEcosystemCategory.value;

  const sourceOptions = [node("option", { text: "全部来源", attributes: { value: "" } })];
  for (const source of payload.facets?.sources || []) {
    sourceOptions.push(node("option", {
      text: `${source.name} · ${source.count}`,
      attributes: { value: source.name },
    }));
  }
  elements.catalogEcosystemSource.replaceChildren(...sourceOptions);
  elements.catalogEcosystemSource.value = [...elements.catalogEcosystemSource.options]
    .some((option) => option.value === filters.source) ? filters.source : "";
  filters.source = elements.catalogEcosystemSource.value;
  elements.catalogEcosystemChain.value = filters.chain;
  elements.catalogEcosystemSort.value = filters.sort;
}

function ecosystemGapOptions() {
  return (state.plan?.stages || []).flatMap((stage) =>
    (stage.capabilityCoverage || [])
      .filter((capability) => capability.required !== false && capability.status === "missing")
      .map((capability) => ({
        stageId: stage.id,
        stageOrder: stage.order,
        stageTitle: stage.title,
        capabilityId: capability.id,
        capabilityLabel: capability.label,
        gapQuery: capability.gapQuery || "",
      })),
  );
}

function renderEcosystemCatalogList(payload) {
  const items = payload.items || [];
  if (!items.some((item) => item.id === state.catalog.selectedKey)) {
    state.catalog.selectedKey = items[0]?.id || null;
  }
  elements.catalogList.replaceChildren();
  if (!items.length) {
    elements.catalogList.append(node("div", { className: "catalog-empty" }, [
      node("span", { text: "∅", attributes: { "aria-hidden": "true" } }),
      node("h3", { text: "没有匹配的生态记录" }),
      node("p", { text: "换一个能力词，或放宽来源与工作流筛选。" }),
    ]));
  }
  for (const item of items) {
    const card = node("button", {
      className: `catalog-item ecosystem-item${item.id === state.catalog.selectedKey ? " selected" : ""}`,
      attributes: { type: "button", "aria-pressed": String(item.id === state.catalog.selectedKey) },
    });
    card.append(
      node("strong", { text: item.group || item.skills.join(" + ") }),
      node("small", { text: `${item.source.name} · ★ ${formatCompactNumber(item.source.stars)}` }),
      node("p", { text: item.description || item.useCase || "公开目录未提供说明。" }),
    );
    const flags = node("span", { className: "catalog-flags" });
    flags.append(node("span", { className: "catalog-flag ecosystem-category-flag", text: item.category }));
    if (item.chain) flags.append(node("span", { className: "catalog-flag chain-flag", text: "强绑定链" }));
    flags.append(node("span", { className: "catalog-flag", text: `${item.skills.length} Skills` }));
    if (item.sourceCount > 1) flags.append(node("span", { className: "catalog-flag comparison-flag", text: `${item.sourceCount} 个同组来源` }));
    if (item.recordable) flags.append(node("span", { className: "catalog-flag recordable-flag", text: "可记录" }));
    card.append(flags);
    card.addEventListener("click", () => {
      state.catalog.ecosystem.comparison.activeGroupId = "";
      resetEcosystemDocument();
      state.catalog.selectedKey = item.id;
      renderEcosystemCatalogList(payload);
      renderEcosystemCatalogDetail(item);
      resetCatalogScroll({ results: false });
      if (window.innerWidth < 820) elements.catalogDetail.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    elements.catalogList.append(card);
  }
  elements.catalogMore.hidden = payload.nextCursor === null || items.length >= payload.total;
}

function selectedCandidateAlreadyRecorded(item, skillName, gap) {
  const packageId = `${item.packageBase}@${skillName}`;
  return (state.activeWorkflow?.externalCandidates || []).some((candidate) =>
    candidate.packageId === packageId
      && candidate.stageId === gap.stageId
      && candidate.capabilityId === gap.capabilityId
      && candidate.status !== "rejected");
}

function localSkillEvidence(skillName) {
  const expected = normalizedSearch(skillName);
  const matches = (state.inventory?.skills || [])
    .filter((skill) => normalizedSearch(skill.name) === expected);
  const active = matches.filter((skill) => skill.enabled !== false);
  return {
    found: active.length > 0,
    disabled: matches.length > 0 && active.length === 0,
    copies: matches.length,
    providers: [...new Set(matches.map((skill) => skill.provider).filter(Boolean))],
  };
}

function ecosystemComparisonFact(label, value) {
  const row = node("div");
  row.append(node("dt", { text: label }), node("dd", { text: value || "未声明" }));
  return row;
}

async function selectEcosystemComparisonItem(item) {
  const ecosystem = state.catalog.ecosystem;
  resetEcosystemDocument();
  if (ecosystem.filters.source) {
    ecosystem.filters.source = "";
    elements.catalogEcosystemSource.value = "";
    ecosystem.cacheKey = "";
    syncCatalogUrl();
    await loadEcosystemCatalog();
  }
  ecosystem.comparison.activeGroupId = "";
  state.catalog.selectedKey = item.id;
  const payload = ecosystem.payload;
  if (payload?.items?.some((entry) => entry.id === item.id)) {
    renderEcosystemCatalogList(payload);
  } else {
    for (const card of elements.catalogList.querySelectorAll(".catalog-item")) {
      card.classList.remove("selected");
      card.setAttribute("aria-pressed", "false");
    }
  }
  renderEcosystemCatalogDetail(item);
  resetCatalogScroll({ results: false });
}

async function loadEcosystemGroupComparison(item, { force = false } = {}) {
  const comparison = state.catalog.ecosystem.comparison;
  comparison.activeGroupId = item.groupId;
  comparison.error = "";
  if (!force && comparison.cache[item.groupId]) {
    renderEcosystemCatalogDetail(item);
    return;
  }
  const requestId = comparison.requestId + 1;
  comparison.requestId = requestId;
  comparison.loadingGroupId = item.groupId;
  renderEcosystemCatalogDetail(item);
  try {
    const payload = await (await api(`/api/ecosystem/groups/${encodeURIComponent(item.groupId)}`)).json();
    if (requestId !== comparison.requestId) return;
    comparison.cache[item.groupId] = payload;
  } catch (error) {
    if (requestId !== comparison.requestId) return;
    comparison.error = error.message;
  } finally {
    if (requestId === comparison.requestId) comparison.loadingGroupId = "";
  }
  if (comparison.activeGroupId === item.groupId && state.catalog.selectedKey === item.id) {
    renderEcosystemCatalogDetail(item);
  }
}

function renderEcosystemComparisonPanel(item) {
  if (item.sourceCount <= 1) return null;
  const comparison = state.catalog.ecosystem.comparison;
  const expanded = comparison.activeGroupId === item.groupId;
  const section = node("section", {
    className: `specimen-section ecosystem-comparison${expanded ? " expanded" : ""}`,
  });
  const heading = node("header", { className: "ecosystem-comparison-heading" });
  const copy = node("div");
  copy.append(
    node("p", { className: "eyebrow", text: "Source evidence bench" }),
    node("h4", { text: `同功能来源 · ${item.sourceCount}` }),
    node("p", { text: "把同一功能组的仓库证据并排核对，再决定记录哪一个；这里不生成综合安全分。" }),
  );
  const toggle = node("button", {
    className: "button button-quiet comparison-toggle",
    text: expanded ? "收起来源对比" : `比较 ${item.sourceCount} 个来源`,
    attributes: { type: "button", "aria-expanded": String(expanded) },
  });
  toggle.addEventListener("click", handle(async () => {
    if (expanded) {
      comparison.activeGroupId = "";
      renderEcosystemCatalogDetail(item);
      return;
    }
    await loadEcosystemGroupComparison(item);
  }));
  heading.append(copy, toggle);
  section.append(heading);
  if (!expanded) return section;

  if (comparison.loadingGroupId === item.groupId) {
    section.append(node("div", { className: "comparison-loading" }, [
      node("i", { attributes: { "aria-hidden": "true" } }),
      node("span", { text: "正在对齐同组来源证据……" }),
    ]));
    return section;
  }
  if (comparison.error) {
    const retry = node("button", { className: "button button-quiet", text: "重新载入对比", attributes: { type: "button" } });
    retry.addEventListener("click", handle(() => loadEcosystemGroupComparison(item, { force: true })));
    section.append(node("div", { className: "comparison-error" }, [
      node("strong", { text: "来源对比暂时不可用" }),
      node("span", { text: comparison.error }),
      retry,
    ]));
    return section;
  }

  const payload = comparison.cache[item.groupId];
  if (!payload) return section;
  const grid = node("div", { className: "ecosystem-comparison-grid" });
  for (const candidate of payload.items || []) {
    const current = candidate.id === item.id;
    const card = node("article", { className: `ecosystem-comparison-card${current ? " current" : ""}` });
    const cardHeading = node("header");
    const title = node("div");
    title.append(
      node("span", { className: "comparison-source-index", text: String((payload.items || []).indexOf(candidate) + 1).padStart(2, "0") }),
      node("h5", { text: candidate.source.name || candidate.packageBase || "未命名来源" }),
    );
    cardHeading.append(title);
    if (current) cardHeading.append(node("span", { className: "comparison-current", text: "当前审阅" }));
    card.append(cardHeading);

    const facts = node("dl", { className: "comparison-facts" });
    facts.append(
      ecosystemComparisonFact("GitHub Stars", formatCompactNumber(candidate.source.stars)),
      ecosystemComparisonFact("最近提交", candidate.source.lastCommit ? formatDate(candidate.source.lastCommit) : "未声明"),
      ecosystemComparisonFact("许可证", candidate.source.license || "未声明"),
      ecosystemComparisonFact("来源类型", candidate.source.type || "未声明"),
      ecosystemComparisonFact("目录映射", candidate.recordable ? `可绑定 ${candidate.recordableSkills.length} 个 Skill` : "仅供阅读参考"),
      ecosystemComparisonFact("安装包", candidate.packageBase || "未映射"),
    );
    card.append(facts);

    const skills = node("div", { className: "comparison-skills" });
    const visibleSkills = candidate.recordableSkills.length ? candidate.recordableSkills : candidate.skills;
    for (const skill of visibleSkills.slice(0, 8)) skills.append(node("code", { text: skill }));
    if (visibleSkills.length > 8) skills.append(node("span", { text: `+${visibleSkills.length - 8}` }));
    card.append(skills);

    const actions = node("div", { className: "comparison-actions" });
    if (candidate.source.url) {
      actions.append(node("a", {
        text: "查看上游 ↗",
        attributes: { href: candidate.source.url, target: "_blank", rel: "noopener noreferrer" },
      }));
    }
    const select = node("button", {
      className: "button button-quiet",
      text: current ? "当前来源" : "审阅该来源",
      attributes: { type: "button", ...(current ? { disabled: "" } : {}) },
    });
    if (!current) select.addEventListener("click", handle(() => selectEcosystemComparisonItem(candidate)));
    actions.append(select);
    card.append(actions);
    grid.append(card);
  }
  section.append(
    grid,
    node("p", { className: "ecosystem-comparison-warning", text: payload.warning }),
  );
  return section;
}

function ecosystemDocumentKey(itemId, skillName) {
  return `${itemId}::${skillName}`;
}

function prepareEcosystemDocument(item) {
  const review = state.catalog.ecosystem.document;
  const skills = item.previewableSkills || [];
  if (review.itemId !== item.id) {
    review.itemId = item.id;
    review.skillName = skills[0] || "";
    review.error = "";
    review.loadingKey = "";
    review.requestId += 1;
  } else if (!skills.includes(review.skillName)) {
    review.skillName = skills[0] || "";
  }
  return review;
}

async function loadEcosystemSkillDocument(item, { refresh = false } = {}) {
  const review = prepareEcosystemDocument(item);
  const skillName = review.skillName;
  if (!skillName) throw new Error("这份目录记录没有可审阅的 Skill 原文路径");
  const key = ecosystemDocumentKey(item.id, skillName);
  if (!refresh && review.cache[key]) {
    renderEcosystemCatalogDetail(item);
    return;
  }
  const requestId = review.requestId + 1;
  review.requestId = requestId;
  review.loadingKey = key;
  review.error = "";
  renderEcosystemCatalogDetail(item);
  try {
    const suffix = refresh ? "?refresh=1" : "";
    const payload = await (await api(`/api/ecosystem/items/${encodeURIComponent(item.id)}/skills/${encodeURIComponent(skillName)}/document${suffix}`)).json();
    if (requestId !== review.requestId) return;
    review.cache[key] = payload;
  } catch (error) {
    if (requestId !== review.requestId) return;
    review.error = error.message;
  } finally {
    if (requestId === review.requestId) review.loadingKey = "";
  }
  if (review.itemId === item.id && review.skillName === skillName && state.catalog.selectedKey === item.id) {
    renderEcosystemCatalogDetail(item);
  }
}

function reviewSeverity(value) {
  const labels = {
    none: "未命中内置规则",
    low: "低等级线索",
    medium: "中等级线索",
    high: "高等级线索",
    critical: "严重线索",
  };
  const severity = Object.hasOwn(labels, value) ? value : "none";
  return { severity, label: labels[severity] };
}

function focusDocumentLine(reader, line) {
  const target = reader.querySelector(`[data-line="${line}"]`);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.remove("finding-focus");
  window.requestAnimationFrame(() => target.classList.add("finding-focus"));
  window.setTimeout(() => target.classList.remove("finding-focus"), 1_600);
}

function renderEcosystemDocumentEvidence(payload) {
  const wrapper = node("div", { className: "document-evidence" });
  const meta = node("div", { className: "document-provenance" });
  const shortHash = payload.document.sha256.slice(0, 16);
  meta.append(
    specimenFact("仓库与分支", `${payload.source.repository}@${payload.source.branch}`),
    specimenFact("精确路径", payload.source.path),
    specimenFact("内容指纹", `sha256:${shortHash}…`),
    specimenFact("原文规模", `${payload.document.lines.toLocaleString("zh-CN")} 行 · ${payload.document.bytes.toLocaleString("zh-CN")} B`),
  );
  wrapper.append(meta);

  const statusRow = node("div", { className: "document-status-row" });
  statusRow.append(
    node("span", {
      className: `document-severity severity-${reviewSeverity(payload.review.severity).severity}`,
      text: reviewSeverity(payload.review.severity).label,
    }),
    node("span", { text: `${payload.cached ? "本机缓存" : "刚刚读取"} · ${formatDate(payload.document.fetchedAt)}` }),
  );
  if (payload.rateLimit.remaining !== null) {
    statusRow.append(node("span", { text: `GitHub 读取额度 ${payload.rateLimit.remaining}/${payload.rateLimit.limit || "?"}` }));
  }
  if (payload.source.documentUrl) {
    statusRow.append(node("a", {
      text: "在上游核对原文 ↗",
      attributes: { href: payload.source.documentUrl, target: "_blank", rel: "noopener noreferrer" },
    }));
  }
  wrapper.append(statusRow);

  const bench = node("div", { className: "document-review-bench" });
  const reader = node("div", { className: "document-source-reader" });
  reader.append(node("header", {}, [
    node("span", { text: payload.source.path }),
    node("small", { text: "只读 UTF-8 · 未执行" }),
  ]));
  const lineList = node("ol", { className: "document-source-lines", attributes: { "aria-label": `${payload.skillName} 原文` } });
  const lines = payload.document.content.split(/\r?\n/);
  const visibleLimit = 5_000;
  const findingSeverityByLine = new Map();
  for (const finding of payload.review.findings || []) {
    const current = findingSeverityByLine.get(finding.line);
    if (!current || ["none", "low", "medium", "high", "critical"].indexOf(finding.severity)
      > ["none", "low", "medium", "high", "critical"].indexOf(current)) {
      findingSeverityByLine.set(finding.line, finding.severity);
    }
  }
  for (const [index, value] of lines.slice(0, visibleLimit).entries()) {
    const lineNumber = index + 1;
    const severity = findingSeverityByLine.get(lineNumber);
    lineList.append(node("li", {
      className: severity ? `finding-line severity-${severity}` : "",
      dataset: { line: String(lineNumber) },
      attributes: { value: String(lineNumber) },
    }, [node("code", { text: value || " " })]));
  }
  reader.append(lineList);
  if (lines.length > visibleLimit) {
    reader.append(node("p", {
      className: "document-reader-limit",
      text: `阅读器为保持响应只展开前 ${visibleLimit.toLocaleString("zh-CN")} 行；完整原文请在上游核对。`,
    }));
  }

  const findings = node("aside", { className: "document-findings" });
  findings.append(
    node("p", { className: "eyebrow", text: "Rule cues" }),
    node("h5", { text: `静态线索 · ${(payload.review.findings || []).length}` }),
  );
  const parsed = node("div", { className: "document-frontmatter" });
  parsed.append(node("strong", { text: payload.frontmatter.name || payload.skillName }));
  parsed.append(node("p", { text: payload.frontmatter.description || "frontmatter 未提供用途说明。" }));
  if (payload.frontmatter.allowedTools?.length) {
    const tools = node("div", { className: "document-tool-list" });
    for (const tool of payload.frontmatter.allowedTools) tools.append(node("code", { text: tool }));
    parsed.append(node("span", { text: "声明工具" }), tools);
  } else parsed.append(node("span", { text: "未解析到 allowed-tools 声明" }));
  findings.append(parsed);

  if (!(payload.review.findings || []).length) {
    findings.append(node("div", { className: "document-no-findings" }, [
      node("strong", { text: "内置规则未命中" }),
      node("p", { text: "这不是安全结论；仍需人工阅读行为边界、脚本、权限和外部引用。" }),
    ]));
  } else {
    const listNode = node("div", { className: "document-finding-list" });
    for (const finding of payload.review.findings) {
      const canFocus = finding.line <= visibleLimit;
      const findingButton = node("button", {
        className: `document-finding severity-${reviewSeverity(finding.severity).severity}`,
        attributes: { type: "button", ...(canFocus ? {} : { disabled: "" }) },
      });
      findingButton.append(
        node("span", { text: `${reviewSeverity(finding.severity).label} · L${finding.line}` }),
        node("strong", { text: finding.message }),
      );
      if (finding.excerpt) findingButton.append(node("code", { text: finding.excerpt }));
      if (canFocus) findingButton.addEventListener("click", () => focusDocumentLine(reader, finding.line));
      listNode.append(findingButton);
    }
    findings.append(listNode);
  }
  bench.append(reader, findings);
  wrapper.append(
    bench,
    node("p", { className: "document-review-warning", text: payload.warning }),
  );
  return wrapper;
}

function renderEcosystemDocumentReview(item) {
  const review = prepareEcosystemDocument(item);
  const section = node("section", { className: "specimen-section ecosystem-document-review" });
  const heading = node("header", { className: "document-review-heading" });
  const copy = node("div");
  copy.append(
    node("p", { className: "eyebrow", text: "Pre-install source review" }),
    node("h4", { text: "安装前原文审阅" }),
    node("p", { text: "服务端只读取目录映射的单份 SKILL.md；原文不交给模型，也不会触发安装或命令执行。" }),
  );
  heading.append(copy);
  const skills = item.previewableSkills || [];
  if (!skills.length) {
    section.append(
      heading,
      node("div", { className: "document-review-empty" }, [
        node("strong", { text: "暂无可验证原文路径" }),
        node("p", { text: "该来源未提供与 GitHub 仓库一致的安全相对路径；仍可打开上游手动核对。" }),
      ]),
    );
    return section;
  }

  const controls = node("div", { className: "document-review-controls" });
  const select = node("select", { attributes: { "aria-label": "选择要审阅的 Skill 原文" } });
  for (const skill of skills) select.append(node("option", { text: skill, attributes: { value: skill } }));
  select.value = review.skillName;
  const key = ecosystemDocumentKey(item.id, review.skillName);
  const payload = review.cache[key];
  const loading = review.loadingKey === key;
  const loadButton = node("button", {
    className: "button button-primary",
    text: loading ? "正在读取原文……" : payload ? "重新读取原文" : "读取并检查原文",
    attributes: { type: "button", ...(loading ? { disabled: "" } : {}) },
  });
  select.addEventListener("change", () => {
    review.skillName = select.value;
    review.error = "";
    review.loadingKey = "";
    review.requestId += 1;
    renderEcosystemCatalogDetail(item);
  });
  loadButton.addEventListener("click", handle(() => loadEcosystemSkillDocument(item, { refresh: Boolean(payload) })));
  controls.append(select, loadButton);
  heading.append(controls);
  section.append(heading);

  if (loading) {
    section.append(node("div", { className: "document-review-loading", attributes: { "aria-live": "polite" } }, [
      node("i", { attributes: { "aria-hidden": "true" } }),
      node("span", { text: "正在读取受限原文并运行本地静态规则……" }),
    ]));
  } else if (review.error) {
    section.append(node("div", { className: "document-review-error" }, [
      node("strong", { text: "原文审阅暂时不可用" }),
      node("p", { text: review.error }),
    ]));
  } else if (payload) section.append(renderEcosystemDocumentEvidence(payload));
  else {
    section.append(node("div", { className: "document-review-empty" }, [
      node("strong", { text: `待审阅 · ${review.skillName}` }),
      node("p", { text: "读取后会显示精确来源、内容指纹、带行号原文与规则命中；未读取前不推断安全性。" }),
    ]));
  }
  return section;
}

async function recordEcosystemCandidate(item, skillName, gap, rationale) {
  if (!state.activeWorkflow) throw new Error("请先选择工作流");
  const workflow = await (await api(`/api/workflows/${encodeURIComponent(state.activeWorkflow.id)}/external-candidates`, {
    method: "POST",
    body: JSON.stringify({
      expectedRevision: state.activeWorkflow.revision,
      catalogItemId: item.id,
      skillName,
      stageId: gap.stageId,
      capabilityId: gap.capabilityId,
      query: elements.catalogSearch.value.trim() || gap.gapQuery,
      rationale,
    }),
  })).json();
  applyWorkflow(workflow);
  await fetchWorkflowList();
  await generatePlan({ preserveSelection: true });
  toast("已记录为缺口候选；请在能力面板中审阅后再加入安装计划");
}

async function recordEcosystemChainCandidates(item, skillNames, gap, rationale) {
  if (!state.activeWorkflow) throw new Error("请先选择工作流");
  const workflow = await (await api(`/api/workflows/${encodeURIComponent(state.activeWorkflow.id)}/external-candidates`, {
    method: "POST",
    body: JSON.stringify({
      expectedRevision: state.activeWorkflow.revision,
      catalogItemId: item.id,
      skillNames,
      stageId: gap.stageId,
      capabilityId: gap.capabilityId,
      query: elements.catalogSearch.value.trim() || gap.gapQuery,
      rationale,
    }),
  })).json();
  applyWorkflow(workflow);
  await fetchWorkflowList();
  await generatePlan({ preserveSelection: true });
  toast(`已原子记录 ${skillNames.length} 个组合链候选；仍需逐项审阅和接受`);
}

function renderEcosystemChainCandidateForm(item) {
  const section = node("section", { className: "specimen-section ecosystem-record-panel ecosystem-chain-panel" });
  section.append(
    node("p", { className: "eyebrow", text: "Chain coverage ledger" }),
    node("h4", { text: "组合链覆盖检查" }),
    node("p", {
      className: "muted",
      text: "编号复现目录声明顺序；本机状态只做名称精确匹配，不代表目标 Agent 可用或已经运行验证。",
    }),
  );

  const chainSummary = node("div", { className: "chain-coverage-summary", attributes: { "aria-live": "polite" } });
  const summaryLocal = node("div", {}, [node("span", { text: "本机发现" }), node("strong")]);
  const summaryRecorded = node("div", {}, [node("span", { text: "此缺口已记录" }), node("strong")]);
  const summaryPending = node("div", {}, [node("span", { text: "可新增" }), node("strong")]);
  chainSummary.append(summaryLocal, summaryRecorded, summaryPending);

  const chainList = node("ol", { className: "ecosystem-chain-list", attributes: { "aria-label": `${item.group} 组合链成员` } });
  const memberRows = item.skills.map((skillName, index) => {
    const row = node("li", { className: "ecosystem-chain-member" });
    const marker = node("span", { className: "chain-member-index", text: String(index + 1).padStart(2, "0") });
    const copy = node("div", { className: "chain-member-copy" });
    const name = node("strong", { text: skillName });
    const detail = node("small");
    copy.append(name, detail);
    const badge = node("span", { className: "chain-member-status" });
    row.append(marker, copy, badge);
    chainList.append(row);
    return { skillName, row, detail, badge };
  });
  section.append(chainSummary, chainList);

  let initialLocalCount = 0;
  let initialPendingCount = 0;
  for (const member of memberRows) {
    const local = localSkillEvidence(member.skillName);
    const recordable = item.recordableSkills.includes(member.skillName);
    if (local.found) initialLocalCount += 1;
    else if (recordable) initialPendingCount += 1;
    member.row.dataset.status = local.found ? "local" : local.disabled ? "disabled" : recordable ? "available" : "reference";
    member.badge.textContent = local.found
      ? "本机已发现"
      : local.disabled
        ? "本机已禁用"
        : recordable ? "可记录候选" : "仅供参考";
    member.detail.textContent = local.providers.length
      ? `${local.providers.join(" / ")}${local.copies > 1 ? ` · ${local.copies} 份路径` : ""}`
      : recordable
        ? `${item.packageBase}@${member.skillName} · 尚未记录`
        : "当前来源没有可验证的安装映射";
  }
  summaryLocal.querySelector("strong").textContent = `${initialLocalCount}/${item.skills.length}`;
  summaryRecorded.querySelector("strong").textContent = "—";
  summaryPending.querySelector("strong").textContent = String(initialPendingCount);

  if (!state.activeWorkflow || !state.plan) {
    section.append(node("div", { className: "ecosystem-record-note", text: "选择一份工作流后，才能计算目标缺口并记录未覆盖的组合成员。" }));
    return section;
  }
  const gaps = ecosystemGapOptions();
  if (!gaps.length) {
    section.append(node("div", { className: "ecosystem-record-note", text: "当前工作流没有必需且缺失的能力；这里只保留本机覆盖视图。" }));
    return section;
  }

  const form = node("form", { className: "ecosystem-record-form ecosystem-chain-form" });
  const gapSelect = node("select", { attributes: { "aria-label": "选择组合链目标缺口" } });
  for (const gap of gaps) {
    gapSelect.append(node("option", {
      text: `${String(gap.stageOrder).padStart(2, "0")} ${gap.stageTitle} / ${gap.capabilityLabel}`,
      attributes: { value: JSON.stringify([gap.stageId, gap.capabilityId]) },
    }));
  }
  const preferredGap = gaps.find((gap) => gap.stageId === state.selectedStageId) || gaps[0];
  gapSelect.value = JSON.stringify([preferredGap.stageId, preferredGap.capabilityId]);
  const rationale = node("textarea", {
    attributes: { rows: "3", maxlength: "2000", placeholder: "补充为何需要整条组合链（可选）" },
  });
  const gapLabel = node("label", { className: "ecosystem-chain-gap" }, [node("span", { text: "目标缺口" }), gapSelect]);
  const rationaleLabel = node("label", { className: "ecosystem-rationale" }, [node("span", { text: "组合记录依据" }), rationale]);
  const submit = node("button", { className: "button button-primary", attributes: { type: "submit" } });
  const boundary = node("p", {
    className: "chain-boundary-note",
    text: "批量记录是一次原子元数据变更；接受、安装计划和安装仍按成员逐项人工处理。",
  });
  let pendingSkills = [];

  const selectedGap = () => {
    const [stageId, capabilityId] = JSON.parse(gapSelect.value);
    return gaps.find((gap) => gap.stageId === stageId && gap.capabilityId === capabilityId);
  };
  const updateChainState = () => {
    const gap = selectedGap();
    let localCount = 0;
    let recordedCount = 0;
    pendingSkills = [];
    for (const member of memberRows) {
      const local = localSkillEvidence(member.skillName);
      const recorded = gap && selectedCandidateAlreadyRecorded(item, member.skillName, gap);
      const recordable = item.recordableSkills.includes(member.skillName);
      let status = "reference";
      let label = "仅供参考";
      if (local.found) {
        status = "local";
        label = "本机已发现";
        localCount += 1;
      } else if (recorded) {
        status = "recorded";
        label = "此缺口已记录";
        recordedCount += 1;
      } else if (local.disabled) {
        status = "disabled";
        label = "本机已禁用";
        if (recordable) pendingSkills.push(member.skillName);
      } else if (recordable) {
        status = "available";
        label = "可记录候选";
        pendingSkills.push(member.skillName);
      }
      if (local.found && recorded) recordedCount += 1;
      member.row.dataset.status = status;
      member.badge.textContent = label;
      const localSource = local.providers.length
        ? `${local.providers.join(" / ")}${local.copies > 1 ? ` · ${local.copies} 份路径` : ""}`
        : "";
      member.detail.textContent = local.found || local.disabled
        ? `${localSource || "本机精确名称命中"}${recorded ? " · 该缺口另有候选记录" : ""}`
        : recorded
          ? `${item.packageBase}@${member.skillName} · 尚未接受或执行`
          : recordable
            ? `${item.packageBase}@${member.skillName} · 尚未记录`
            : "当前来源没有可验证的安装映射";
    }
    summaryLocal.querySelector("strong").textContent = `${localCount}/${item.skills.length}`;
    summaryRecorded.querySelector("strong").textContent = String(recordedCount);
    summaryPending.querySelector("strong").textContent = String(pendingSkills.length);
    submit.disabled = !gap || !pendingSkills.length;
    if (pendingSkills.length) submit.textContent = `记录 ${pendingSkills.length} 个未覆盖成员`;
    else if (memberRows.every((member) => ["local", "recorded"].includes(member.row.dataset.status))) {
      submit.textContent = "该缺口无需新增记录";
    } else submit.textContent = "其余成员仅供参考";
  };

  gapSelect.addEventListener("change", updateChainState);
  form.addEventListener("submit", handle(async (event) => {
    event.preventDefault();
    const gap = selectedGap();
    if (!gap) throw new Error("目标能力缺口已变化，请重新选择");
    if (!pendingSkills.length) return;
    const skillNames = [...pendingSkills];
    submit.disabled = true;
    submit.textContent = `正在记录 ${skillNames.length} 个成员……`;
    await recordEcosystemChainCandidates(item, skillNames, gap, rationale.value.trim());
  }));
  form.append(gapLabel, rationaleLabel, boundary, submit);
  section.append(form);
  updateChainState();
  return section;
}

function renderEcosystemCandidateForm(item) {
  if (item.chain) return renderEcosystemChainCandidateForm(item);
  const section = node("section", { className: "specimen-section ecosystem-record-panel" });
  section.append(
    node("p", { className: "eyebrow", text: "Controlled handoff" }),
    node("h4", { text: "绑定到当前能力缺口" }),
    node("p", { className: "muted", text: "这里只保存候选元数据。接受候选、生成安装计划和实际写入仍是后续独立人工步骤。" }),
  );
  if (!state.activeWorkflow || !state.plan) {
    section.append(node("div", { className: "ecosystem-record-note", text: "选择一份工作流后，才能把生态记录绑定到能力缺口。" }));
    return section;
  }
  const gaps = ecosystemGapOptions();
  if (!gaps.length) {
    section.append(node("div", { className: "ecosystem-record-note", text: "当前工作流没有必需且缺失的能力；无需记录外部候选。" }));
    return section;
  }
  if (!item.recordable) {
    section.append(node("div", { className: "ecosystem-record-note", text: "该来源没有可验证的 skills CLI 包映射，仅保留为阅读线索。" }));
    return section;
  }

  const form = node("form", { className: "ecosystem-record-form" });
  const skillSelect = node("select", { attributes: { "aria-label": "选择 Skill" } });
  for (const skill of item.recordableSkills) {
    skillSelect.append(node("option", { text: skill, attributes: { value: skill } }));
  }
  const previewedSkill = state.catalog.ecosystem.document.itemId === item.id
    ? state.catalog.ecosystem.document.skillName
    : "";
  if (item.recordableSkills.includes(previewedSkill)) skillSelect.value = previewedSkill;
  const gapSelect = node("select", { attributes: { "aria-label": "选择能力缺口" } });
  for (const gap of gaps) {
    gapSelect.append(node("option", {
      text: `${String(gap.stageOrder).padStart(2, "0")} ${gap.stageTitle} / ${gap.capabilityLabel}`,
      attributes: { value: JSON.stringify([gap.stageId, gap.capabilityId]) },
    }));
  }
  const preferredGap = gaps.find((gap) => gap.stageId === state.selectedStageId) || gaps[0];
  gapSelect.value = JSON.stringify([preferredGap.stageId, preferredGap.capabilityId]);
  const rationale = node("textarea", {
    attributes: { rows: "3", maxlength: "2000", placeholder: "补充它为何可能填补该缺口（可选）" },
  });
  const skillLabel = node("label", {}, [node("span", { text: "候选 Skill" }), skillSelect]);
  const gapLabel = node("label", {}, [node("span", { text: "目标缺口" }), gapSelect]);
  const rationaleLabel = node("label", { className: "ecosystem-rationale" }, [node("span", { text: "记录依据" }), rationale]);
  const submit = node("button", { className: "button button-primary", text: "记录为缺口候选", attributes: { type: "submit" } });

  const updateSubmit = () => {
    const [stageId, capabilityId] = JSON.parse(gapSelect.value);
    const gap = gaps.find((entry) => entry.stageId === stageId && entry.capabilityId === capabilityId);
    const duplicate = gap && selectedCandidateAlreadyRecorded(item, skillSelect.value, gap);
    submit.disabled = Boolean(duplicate);
    submit.textContent = duplicate ? "该缺口已记录" : "记录为缺口候选";
  };
  skillSelect.addEventListener("change", updateSubmit);
  gapSelect.addEventListener("change", updateSubmit);
  form.addEventListener("submit", handle(async (event) => {
    event.preventDefault();
    const [stageId, capabilityId] = JSON.parse(gapSelect.value);
    const gap = gaps.find((entry) => entry.stageId === stageId && entry.capabilityId === capabilityId);
    if (!gap) throw new Error("目标能力缺口已变化，请重新选择");
    submit.disabled = true;
    await recordEcosystemCandidate(item, skillSelect.value, gap, rationale.value.trim());
  }));
  form.append(skillLabel, gapLabel, rationaleLabel, submit);
  section.append(form);
  updateSubmit();
  return section;
}

function renderEcosystemCatalogDetail(item) {
  elements.catalogDetail.replaceChildren();
  if (!item) {
    elements.catalogDetail.append(node("div", { className: "catalog-empty" }, [
      node("span", { text: "⌖", attributes: { "aria-hidden": "true" } }),
      node("h3", { text: "选择一条生态记录" }),
      node("p", { text: "这里会拆开来源、用例、技能组合和可记录边界。" }),
    ]));
    return;
  }
  const heading = node("header", { className: "specimen-heading ecosystem-heading" });
  heading.append(
    node("p", { className: "eyebrow", text: `${item.category} · ${item.subsection}${item.chain ? " · 强绑定链" : ""}` }),
    node("h3", { text: item.group || item.skills.join(" + ") }),
    node("p", { text: item.description || item.useCase || "公开目录未提供说明。" }),
  );
  elements.catalogDetail.append(heading);

  const comparisonPanel = renderEcosystemComparisonPanel(item);
  if (comparisonPanel) elements.catalogDetail.append(comparisonPanel);

  const facts = node("div", { className: "specimen-grid ecosystem-facts" });
  facts.append(
    specimenFact("来源", item.source.name),
    specimenFact("GitHub Stars", formatCompactNumber(item.source.stars)),
    specimenFact("最近提交", item.source.lastCommit ? formatDate(item.source.lastCommit) : "未声明"),
    specimenFact("许可证", item.source.license),
    specimenFact("来源类型", item.source.type),
    specimenFact("工作流关系", item.chain ? "强绑定组合" : "可独立采用"),
  );
  elements.catalogDetail.append(facts);

  const skillsSection = node("section", { className: "specimen-section" });
  skillsSection.append(node("h4", { text: `包含 Skills · ${item.skills.length}` }));
  const skillList = node("div", { className: "ecosystem-skill-list" });
  for (const skill of item.skills) skillList.append(node("code", { text: skill }));
  skillsSection.append(skillList);
  elements.catalogDetail.append(skillsSection);

  if (item.useCase || item.whenToUse) {
    const guidance = node("section", { className: "specimen-section ecosystem-guidance" });
    guidance.append(node("h4", { text: "采用线索" }));
    if (item.useCase) guidance.append(node("div", {}, [node("strong", { text: "用例" }), node("p", { text: item.useCase })]));
    if (item.whenToUse) guidance.append(node("div", {}, [node("strong", { text: "适用时机" }), node("p", { text: item.whenToUse })]));
    elements.catalogDetail.append(guidance);
  }

  const sourceSection = node("section", { className: "specimen-section ecosystem-source" });
  sourceSection.append(node("h4", { text: "来源与安装声明" }));
  if (item.source.description) sourceSection.append(node("p", { className: "muted", text: item.source.description }));
  if (item.source.installCommand) sourceSection.append(node("code", { className: "ecosystem-install-command", text: item.source.installCommand }));
  if (item.source.url) {
    sourceSection.append(node("a", {
      className: "ecosystem-source-link",
      text: "打开公开来源 ↗",
      attributes: { href: item.source.url, target: "_blank", rel: "noopener noreferrer" },
    }));
  }
  sourceSection.append(node("p", { className: "ecosystem-trust-note", text: "目录数据不等于安全背书；只有显式读取原文才会只读获取单份文档，安装前仍需检查发布者、许可证、脚本与权限。" }));
  elements.catalogDetail.append(
    sourceSection,
    renderEcosystemDocumentReview(item),
    renderEcosystemCandidateForm(item),
  );
}

function renderEcosystemPayload(payload) {
  populateEcosystemFacets(payload);
  const showing = (payload.items || []).length;
  elements.catalogSummary.textContent = `显示 ${showing.toLocaleString("zh-CN")} / ${payload.total.toLocaleString("zh-CN")} 条记录 · ${payload.stats.groups.toLocaleString("zh-CN")} 组能力 · ${payload.stats.skills.toLocaleString("zh-CN")} 个 Skill · ${formatTime(payload.fetchedAt)} 获取`;
  renderEcosystemCatalogList(payload);
  renderEcosystemCatalogDetail(payload.items.find((item) => item.id === state.catalog.selectedKey) || payload.items[0]);
}

async function loadEcosystemCatalog({ refresh = false } = {}) {
  const ecosystem = state.catalog.ecosystem;
  if (refresh) resetEcosystemDocument({ clearCache: true });
  const params = ecosystemQueryParams({ refresh });
  const cacheKey = ecosystemQueryParams().toString();
  if (!refresh && ecosystem.payload && ecosystem.cacheKey === cacheKey) {
    renderEcosystemPayload(ecosystem.payload);
    return;
  }
  const requestId = ecosystem.requestId + 1;
  ecosystem.requestId = requestId;
  ecosystem.loading = true;
  ecosystem.error = "";
  elements.catalogSummary.textContent = "正在读取 Skills Atlas 公开目录……";
  elements.catalogList.replaceChildren(node("div", { className: "catalog-loading" }, [node("i"), node("p", { text: "正在建立生态索引" })]));
  elements.catalogDetail.replaceChildren(node("div", { className: "catalog-empty" }, [node("p", { text: "公开元数据由本机服务拉取和规范化。" })]));
  elements.catalogMore.hidden = true;
  try {
    const payload = await (await api(`/api/ecosystem/catalog?${params}`)).json();
    if (requestId !== ecosystem.requestId || state.catalog.mode !== "ecosystem") return;
    ecosystem.payload = payload;
    ecosystem.cacheKey = cacheKey;
    resetCatalogScroll();
    renderEcosystemPayload(payload);
  } catch (error) {
    if (requestId !== ecosystem.requestId) return;
    ecosystem.error = error.message;
    elements.catalogSummary.textContent = "生态目录暂时不可用；本机目录不受影响。";
    elements.catalogList.replaceChildren(node("div", { className: "catalog-empty" }, [
      node("span", { text: "!", attributes: { "aria-hidden": "true" } }),
      node("h3", { text: "无法读取公开目录" }),
      node("p", { text: error.message }),
    ]));
    elements.catalogDetail.replaceChildren(node("div", { className: "catalog-empty" }, [
      node("p", { text: "可以稍后刷新，或切回本机事实继续工作。" }),
    ]));
  } finally {
    if (requestId === ecosystem.requestId) ecosystem.loading = false;
  }
}

function renderCatalog({ refresh = false } = {}) {
  applyCatalogMode();
  if (state.catalog.mode === "local") {
    renderLocalCatalog();
    return;
  }
  void loadEcosystemCatalog({ refresh });
}

function renderSavedMaps() {
  elements.savedMaps.replaceChildren();
  if (!state.workflows.length) {
    elements.savedMaps.append(node("div", { className: "no-candidates", text: "尚无共享工作流。让 AI Agent 通过 MCP 提交草案后，即可在网页选择和审阅。" }));
    return;
  }
  for (const workflow of state.workflows) {
    const item = node("article", { className: `saved-map${workflow.id === state.activeWorkflow?.id ? " active" : ""}` });
    item.append(
      node("strong", { text: workflow.goal }),
      node("small", {
        text: `${formatDate(workflow.updatedAt)} · 修订 ${workflow.revision} · ${workflow.status === "confirmed" ? `人工确认 v${workflow.confirmedVersion}` : "草案"} · ${workflow.confirmationCount || 0} 个历史版本`,
      }),
    );
    if (workflow.id === state.activeWorkflow?.id && state.activeWorkflow.history?.length) {
      const history = node("ul", { className: "confirmation-history" });
      for (const version of state.activeWorkflow.history.slice(0, 8)) {
        history.append(node("li", {
          text: `v${version.version} · ${formatDate(version.confirmedAt)} · ${version.confirmedBy?.name || "local-user"} · 修订 ${version.workflowRevision}`,
        }));
      }
      item.append(history);
    }
    const actions = node("div");
    if (workflow.id === state.activeWorkflow?.id) {
      actions.append(node("button", { text: "当前", attributes: { type: "button", disabled: "" } }));
    } else {
      const open = node("button", { text: "打开", attributes: { type: "button" } });
      open.addEventListener("click", handle(async () => {
        persistWorkspace({ silent: true });
        await openWorkflow(workflow.id, { assess: true, announce: true });
        elements.workspaceDialog.close();
      }));
      actions.append(open);
    }
    item.append(actions);
    elements.savedMaps.append(item);
  }
}

function renderWorkspaceDialog() {
  renderSavedMaps();
  elements.customRoots.value = customRoots().join("\n");
}

function downloadBlob(contents, filename, type = "application/json") {
  const blob = contents instanceof Blob ? contents : new Blob([contents], { type });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

async function downloadWorkspace() {
  const backup = await (await api("/api/workspace/export")).json();
  downloadBlob(JSON.stringify(backup, null, 2), "capability-atlas-workspace.json");
  toast("共享工作流与确认历史备份已下载");
}

async function restoreWorkspace(file) {
  if (!file) return;
  if (file.size > 20_000_000) throw new Error("备份文件超过 20 MB 限制");
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("无法读取备份：JSON 格式无效");
  }
  const result = await (await api("/api/workspace/import", {
    method: "POST",
    body: JSON.stringify(parsed),
  })).json();
  const settings = await (await api("/api/settings")).json();
  state.workspace.customRoots = settings.customRoots || [];
  persistWorkspace({ silent: true });
  await scan({ refresh: true });
  await fetchWorkflowList();
  const preferred = state.workflows.find((workflow) => workflow.id === state.activeWorkflow?.id) || state.workflows[0];
  if (preferred) await openWorkflow(preferred.id, { assess: true });
  renderWorkspaceDialog();
  elements.workspaceDialog.close();
  toast(`备份已合并：新增 ${result.imported} 个工作流、${result.confirmationVersions} 个确认版本`);
}

function installationStatusLabel(status) {
  return ({
    draft: "待确认",
    queued: "排队中",
    running: "执行中",
    completed: "已完成",
    partial: "部分完成",
    cancelled: "已取消",
    failed: "失败",
    interrupted: "已中断",
    "needs-repair": "需要修复",
  })[status] || status || "未知";
}

function installationItemStatusLabel(status) {
  return ({
    planned: "待执行",
    queued: "排队中",
    running: "执行中",
    installed: "已安装",
    "installed-warning": "已安装 · 待确认警告",
    "already-installed": "已存在 / 已跳过",
    skipped: "已保留并跳过",
    failed: "失败",
    quarantined: "已隔离",
    cancelled: "已取消",
    "needs-repair": "需要修复",
  })[status] || status || "未知";
}

function latestInstallationPlan() {
  return state.activeWorkflow?.installationPlans?.at(-1) || null;
}

function selectedInstallationTargets() {
  return [...elements.installationTargets.querySelectorAll("input[type=checkbox]:checked")].map((input) => input.value);
}

async function fetchInstallationStatus() {
  state.installation.status = await (await api("/api/installations/status")).json();
  return state.installation.status;
}

function renderInstallationGlobalStatus() {
  const status = state.installation.status;
  elements.installationGlobalStatus.replaceChildren();
  if (!status) {
    elements.installationGlobalStatus.append(node("span", { text: "正在读取安装事务状态……" }));
    return;
  }
  elements.installationSharedRoot.textContent = status.sharedRoot;
  const summary = node("div");
  summary.append(
    node("strong", { text: status.needsRepair ? "安装已锁定：需要处理残留" : status.activeJob ? "全局安装事务正在运行" : "安装执行器就绪" }),
    node("span", { text: `30 天留存 · ${formatBytes(status.storageBytes || 0)}${status.lockedByAnotherProcess ? " · 另一进程持有锁" : ""}` }),
  );
  elements.installationGlobalStatus.append(summary);
  if (status.needsRepair) {
    const repair = node("div", { className: "repair-actions" });
    repair.append(node("span", {
      text: status.repair?.reason === "interrupted-job"
        ? "上次事务被中断。检查残留后选择处理方式。"
        : "清理未完整完成；处理前不会启动新安装。",
    }));
    for (const [action, label] of [["rollback", "回滚托管残留"], ["quarantine", "移入隔离区"], ["accept-current", "接受当前状态"]]) {
      const button = node("button", { text: label, attributes: { type: "button" } });
      button.addEventListener("click", handle(() => resolveInstallationRepair(action)));
      repair.append(button);
    }
    elements.installationGlobalStatus.append(repair);
  }
}

function renderInstallationTargets() {
  const status = state.installation.status;
  if (!status) return;
  const existingSelection = new Set(selectedInstallationTargets());
  const planTargets = latestInstallationPlan()?.targetAgents || [];
  const preferred = existingSelection.size ? existingSelection : new Set(planTargets);
  elements.installationTargets.replaceChildren();
  for (const target of status.targets) {
    const label = node("label", { className: `agent-target${target.detected ? " detected" : ""}` });
    const input = node("input", {
      attributes: {
        type: "checkbox",
        value: target.id,
        ...(preferred.has(target.id) ? { checked: "" } : {}),
      },
    });
    label.append(
      input,
      node("span", {}, [
        node("strong", { text: target.label }),
        node("small", { text: `${target.detected ? "已识别" : "未检测到应用目录"}${target.externalInstallSupported ? " · 支持外部安装" : " · 仅本地同步"}` }),
      ]),
    );
    elements.installationTargets.append(label);
  }
}

function riskLabel(risk) {
  return ({
    "derived-source": "派生 / 缓存来源",
    "pre-scan-visible": "安装后才扫描，扫描前可能被 Agent 发现",
    "compatibility-override-required": "兼容性不匹配，需要显式覆盖",
    "external-target-unsupported": "该目标不支持外部 CLI 安装",
  })[risk] || risk;
}

function acknowledgementControl(item, risk, checked, label) {
  const wrapper = node("label", { className: "installation-ack" });
  wrapper.append(
    node("input", {
      className: "install-risk-ack",
      attributes: {
        type: "checkbox",
        "data-risk": risk,
        ...(checked ? { checked: "" } : {}),
      },
    }),
    node("span", { text: label }),
  );
  return wrapper;
}

function renderInstallationItem(item, editable) {
  const itemCanSelect = editable && !["installed", "installed-warning", "quarantined"].includes(item.status);
  const card = node("article", {
    className: `installation-item${state.installation.focusItemId && [item.contentHash, item.externalCandidateId].includes(state.installation.focusItemId) ? " focused" : ""}`,
    dataset: { itemId: item.id, type: item.type, status: item.status },
  });
  const heading = node("header");
  const select = node("input", {
    className: "install-item-select",
    attributes: {
      type: "checkbox",
      ...(item.selected && itemCanSelect ? { checked: "" } : {}),
      ...(!itemCanSelect || !item.eligible ? { disabled: "" } : {}),
      "aria-label": `选择 ${item.name}`,
    },
  });
  const title = node("div");
  title.append(
    node("span", { className: "receipt-kicker", text: item.type === "local-sync" ? "LOCAL SYNC" : "EXTERNAL INSTALL" }),
    node("h4", { text: item.name }),
    node("p", { text: item.capabilityRefs.map((capability) => capability.label).join(" · ") || "未覆盖必需能力，默认不选择" }),
  );
  heading.append(select, title, node("span", { className: "installation-item-status", text: installationItemStatusLabel(item.status) }));
  card.append(heading);

  const facts = node("div", { className: "installation-paths" });
  if (item.sourcePath) facts.append(node("div", {}, [node("span", { text: "来源" }), node("code", { text: item.sourcePath })]));
  facts.append(node("div", {}, [node("span", { text: "共享" }), node("code", { text: item.canonicalPath })]));
  for (const [agent, targetPath] of Object.entries(item.targetPaths || {})) {
    facts.append(node("div", {}, [node("span", { text: agent }), node("code", { text: targetPath })]));
  }
  if (item.command?.length) facts.append(node("div", {}, [node("span", { text: "命令" }), node("code", { text: item.command.join(" ") })]));
  card.append(facts);

  if (item.riskFlags.length || item.conflict.status !== "none") {
    const risks = node("div", { className: "installation-risks" });
    for (const risk of item.riskFlags) risks.append(node("span", { text: riskLabel(risk) }));
    if (item.conflict.status !== "none") risks.append(node("span", { text: `冲突：${item.conflict.details || item.conflict.status}` }));
    card.append(risks);
  }

  if (editable) {
    const options = node("div", { className: "installation-item-options" });
    if (["different-content", "target-conflict"].includes(item.conflict.status)) {
      const conflictLabel = node("label");
      conflictLabel.append(node("span", { text: "冲突处理" }));
      const conflict = node("select", { className: "install-conflict-resolution" });
      const resolutions = item.type === "external-install"
        ? [["keep", "保留现有并跳过"], ["replace", "快照后替换"]]
        : [["keep", "保留现有并跳过"], ["replace", "快照后替换"], ["rename", "改名安装"]];
      for (const [value, label] of resolutions) {
        const option = node("option", { text: label, attributes: { value } });
        option.selected = item.conflict.resolution === value;
        conflict.append(option);
      }
      conflictLabel.append(conflict);
      options.append(conflictLabel);
      if (item.type === "local-sync") {
        const rename = node("input", {
          className: "install-rename-to",
          attributes: { type: "text", value: item.conflict.renameTo || `${item.installName}-${item.id.slice(-6)}`, placeholder: "新的 Skill 目录名" },
        });
        options.append(rename);
      }
      options.append(acknowledgementControl(item, "replace-existing", item.acknowledgements.includes("replace-existing"), "若选择替换，我确认先创建可恢复快照"));
    }
    if (item.riskFlags.includes("pre-scan-visible")) {
      options.append(acknowledgementControl(item, "pre-scan-visible", item.acknowledgements.includes("pre-scan-visible"), "我理解外部 Skill 在安装后扫描前可能短暂对 Agent 可见"));
    }
    if (item.riskFlags.includes("compatibility-override-required")) {
      options.append(acknowledgementControl(item, "compatibility-override", item.acknowledgements.includes("compatibility-override"), "我确认覆盖兼容性提示，并保留该决定的审计记录"));
    }
    if (item.type === "external-install" && item.status === "already-installed") {
      options.append(acknowledgementControl(item, "reinstall-latest", item.reinstallLatest, "显式重新安装执行时的最新版本"));
    }
    if (options.childElementCount) card.append(options);
  }

  if (item.securityScan) {
    const scan = node("div", { className: `installation-scan ${item.securityScan.status}` });
    scan.append(node("strong", { text: `安全扫描：${item.securityScan.severity}` }));
    for (const finding of item.securityScan.findings || []) {
      scan.append(node("span", { text: `${finding.severity} · ${finding.file} · ${finding.message}` }));
    }
    if (item.status === "installed-warning") {
      const acknowledge = node("button", { text: "已审阅并接受警告", attributes: { type: "button" } });
      acknowledge.addEventListener("click", handle(() => acknowledgeInstallationWarnings([item.id])));
      scan.append(acknowledge);
    }
    card.append(scan);
  }
  if (item.discovered) {
    card.append(node("div", {
      className: `installation-discovery${item.discovered.found ? " found" : ""}`,
      text: item.discovered.found
        ? `重新扫描已发现 · ${(item.discovered.providers || []).join(" / ") || "已识别来源"} · ${(item.discovered.agents || []).join(" / ") || "目标 Agent"}`
        : "重新扫描未发现；该项目不计为安装成功",
    }));
  }
  if (item.error) card.append(node("p", { className: "installation-error", text: item.error }));
  if (["installed", "installed-warning", "already-installed"].includes(item.status)) {
    const remove = node("button", { className: "quarantine-item", text: "断开托管链接并移入隔离区", attributes: { type: "button" } });
    remove.addEventListener("click", handle(() => quarantineInstallationItem(item.id)));
    card.append(remove);
  }
  return card;
}

const SKILL_KIT_ACTION = {
  "up-to-date": "指纹一致",
  "local-changes": "同名内容不同",
  "present-unverified": "名称存在 · 待核验",
  disabled: "本机已禁用",
  recorded: "候选已记录",
  missing: "本机缺失",
};

function renderSkillKitPreview() {
  const preview = state.installation.kitPreview;
  if (!preview) return null;
  const section = node("section", { className: "skill-kit-preview" });
  const heading = node("header", { className: "skill-kit-preview-heading" });
  const copy = node("div");
  copy.append(
    node("p", { className: "eyebrow", text: "Imported intent · comparison only" }),
    node("h3", { text: state.installation.kitFileName || "已导入项目 Skill Kit" }),
    node("p", { text: `${preview.manifest.workflow.goal || "未命名工作流"} · ${preview.workflowMatch === "same-workflow" ? "当前工作流" : "可移植意图"}` }),
  );
  const clear = node("button", { className: "kit-preview-clear", text: "清除核对结果", attributes: { type: "button" } });
  clear.addEventListener("click", () => {
    state.installation.kitPreview = null;
    state.installation.kitFileName = "";
    renderInstallationDialog();
  });
  heading.append(copy, clear);

  const checksum = node("div", { className: "skill-kit-checksum" });
  checksum.append(
    node("span", { text: "INTENT SHA-256" }),
    node("code", { text: preview.manifest.intentHash }),
    node("small", { text: `${preview.manifest.skills.length} 项 · ${preview.manifest.targetAgents.join(" / ") || "未声明目标 Agent"}` }),
  );

  const summary = node("div", { className: "skill-kit-summary" });
  for (const [label, value, status] of [
    ["指纹一致", `${preview.summary.ready}/${preview.summary.total}`, "ready"],
    ["需要核对", preview.summary.attention, "attention"],
    ["已有候选", preview.summary.recorded, "recorded"],
    ["本机缺失", preview.summary.missing, "missing"],
  ]) {
    summary.append(node("div", { dataset: { status } }, [node("span", { text: label }), node("strong", { text: String(value) })]));
  }

  const itemList = node("ol", { className: "skill-kit-item-list", attributes: { "aria-label": "Skill Kit 一致性核对结果" } });
  for (const item of preview.items) {
    const row = node("li", { className: "skill-kit-item", dataset: { action: item.action } });
    const marker = node("span", { className: "skill-kit-item-order", text: String(item.order).padStart(2, "0") });
    const itemCopy = node("div", { className: "skill-kit-item-copy" });
    itemCopy.append(
      node("strong", { text: item.name }),
      node("code", { text: item.packageId || (item.expectedContentHash ? `sha256:${item.expectedContentHash.slice(0, 16)}…` : item.type) }),
    );
    const observations = item.observed.providers.length
      ? `${item.observed.providers.join(" / ")} · ${item.observed.copies} 份路径`
      : item.candidateStatus
        ? `工作流候选状态：${item.candidateStatus}`
        : "当前本机清单没有精确名称命中";
    itemCopy.append(node("small", { text: observations }));
    const status = node("span", { className: "skill-kit-item-status", text: SKILL_KIT_ACTION[item.action] || item.action });
    row.append(marker, itemCopy, status);
    const observedHash = item.observed.contentHashes[0];
    if (observedHash && ["up-to-date", "local-changes", "present-unverified", "disabled"].includes(item.action)) {
      const inspect = node("button", { className: "kit-row-action", text: "查看本机标本", attributes: { type: "button" } });
      inspect.addEventListener("click", () => {
        elements.installationDialog.close();
        openCatalogFor(observedHash);
      });
      row.append(inspect);
    } else if (item.action === "missing") {
      const discover = node("button", { className: "kit-row-action", text: "在生态目录核对", attributes: { type: "button" } });
      discover.addEventListener("click", () => {
        elements.installationDialog.close();
        openEcosystemForGap(item.name);
      });
      row.append(discover);
    }
    itemList.append(row);
  }

  section.append(
    heading,
    checksum,
    summary,
    itemList,
    node("p", {
      className: "skill-kit-preview-boundary",
      text: `只读核对完成：未创建候选或安装计划，未写入或删除 Skill；本机另有 ${preview.summary.undeclaredLocal} 个未声明名称，全部保持不动。`,
    }),
  );
  return section;
}

function renderSkillKitControls() {
  const plan = latestInstallationPlan();
  const editable = plan && ["draft", "partial", "failed", "cancelled"].includes(plan.status);
  const stale = editable && plan.basedOnRevision !== state.activeWorkflow?.revision;
  elements.skillKitExport.disabled = !plan || stale || state.busy;
  elements.skillKitExport.textContent = plan
    ? editable ? "保存选择并下载 Kit" : "下载该计划的 Kit"
    : "先生成安装计划";
  elements.skillKitImport.disabled = !state.activeWorkflow || state.busy;
}

function renderInstallationReceipt() {
  const plan = latestInstallationPlan();
  elements.installationReceipt.replaceChildren();
  const kitPreview = renderSkillKitPreview();
  if (kitPreview) elements.installationReceipt.append(kitPreview);
  if (!plan) {
    elements.installationReceipt.append(node("div", { className: `installation-empty${kitPreview ? " compact" : ""}` }, [
      node("span", { text: "⌁" }),
      node("h3", { text: "尚未生成安装计划" }),
      node("p", { text: kitPreview
        ? "Kit 核对不会替你创建计划；需要同步时仍从左侧选择目标 Agent 并生成受控回执单。"
        : "选择目标 Agent 后生成回执单。只有已人工确认的本地匹配和已接受的外部缺口候选会进入这里。" }),
    ]));
    elements.saveInstallationPlan.disabled = true;
    elements.executeInstallationPlan.disabled = true;
    elements.cancelInstallationJob.hidden = true;
    return;
  }
  const editable = ["draft", "partial", "failed", "cancelled"].includes(plan.status);
  const running = ["queued", "running"].includes(plan.status);
  const stale = editable && plan.basedOnRevision !== state.activeWorkflow.revision;
  const header = node("section", { className: "receipt-summary" });
  header.append(
    node("div", {}, [node("span", { text: "计划状态" }), node("strong", { text: installationStatusLabel(plan.status) })]),
    node("div", {}, [node("span", { text: "修订绑定" }), node("strong", { text: `r${plan.basedOnRevision}${stale ? " · 已过期" : ""}` })]),
    node("div", {}, [node("span", { text: "必需能力" }), node("strong", { text: `${plan.coverage.covered}/${plan.coverage.required}` })]),
    node("div", {}, [node("span", { text: "目标 Agent" }), node("strong", { text: plan.targetAgents.join(" / ") })]),
  );
  elements.installationReceipt.append(header);
  if (plan.coverage.uncovered.length) {
    elements.installationReceipt.append(node("div", { className: "installation-coverage-gap", text: `仍无可安装候选：${plan.coverage.uncovered.map((item) => item.label).join("、")}` }));
  }
  for (const [type, title] of [["local-sync", "本地 Skill 同步"], ["external-install", "外部 Skill 安装"]]) {
    const items = plan.items.filter((item) => item.type === type);
    if (!items.length) continue;
    const section = node("section", { className: "installation-group" });
    section.append(node("h3", { text: `${title} · ${items.length}` }));
    for (const item of items) section.append(renderInstallationItem(item, editable && !stale));
    elements.installationReceipt.append(section);
  }
  if (!plan.items.length) {
    elements.installationReceipt.append(node("div", { className: "installation-empty compact" }, [
      node("h3", { text: "没有符合准入条件的 Skill" }),
      node("p", { text: "先在候选卡完成人工确认，或接受与必需缺口绑定的外部候选，再重建计划。" }),
    ]));
  }
  if (plan.reassessment?.length) {
    const reassessment = node("section", { className: "installation-reassessment" });
    reassessment.append(node("h3", { text: "安装后重新评估" }));
    for (const item of plan.reassessment) {
      reassessment.append(node("span", { text: `${item.targetAgent} · 匹配 ${Math.round(item.matchScore * 100)}% · 覆盖 ${Math.round(item.coverageRatio * 100)}% · 缺失 ${item.missingRequiredCapabilities}` }));
    }
    if (plan.execution.reloadPending?.length) reassessment.append(node("strong", { text: `已安装，等待 Agent 重新加载：${plan.execution.reloadPending.join("、")}` }));
    elements.installationReceipt.append(reassessment);
  }
  const selected = plan.items.some((item) => item.selected);
  elements.saveInstallationPlan.disabled = !editable || stale;
  elements.executeInstallationPlan.disabled = !editable || stale || !selected || state.installation.status?.needsRepair;
  elements.cancelInstallationJob.hidden = !running || state.installation.status?.activeJob?.planId !== plan.id;
  elements.installationFooterNote.textContent = plan.execution?.message
    || (stale ? "工作流修订已变化：请重建计划后再执行。" : "计划已绑定当前修订与内容指纹。保存选择后才能执行。 ");
  if (state.installation.focusItemId) {
    setTimeout(() => elements.installationReceipt.querySelector(".installation-item.focused")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }
}

function renderInstallationDialog() {
  renderInstallationGlobalStatus();
  renderInstallationTargets();
  renderSkillKitControls();
  renderInstallationReceipt();
}

async function openInstallationDialog({ contentHash = "", externalCandidateId = "" } = {}) {
  if (!state.activeWorkflow) throw new Error("请先选择一份工作流");
  state.installation.focusItemId = contentHash || externalCandidateId || null;
  if (!elements.installationDialog.open) elements.installationDialog.showModal();
  await fetchInstallationStatus();
  renderInstallationDialog();
}

async function createInstallationPlan() {
  if (!state.activeWorkflow) throw new Error("请先选择一份工作流");
  const targetAgents = selectedInstallationTargets();
  if (!targetAgents.length) throw new Error("请至少选择一个目标 Agent");
  const payload = await (await api(`/api/workflows/${encodeURIComponent(state.activeWorkflow.id)}/install-plans`, {
    method: "POST",
    body: JSON.stringify({ expectedRevision: state.activeWorkflow.revision, targetAgents }),
  })).json();
  applyWorkflow(payload.workflow);
  await fetchWorkflowList();
  await fetchInstallationStatus();
  renderInstallationDialog();
  toast("安装回执单已生成；尚未执行任何写入");
}

async function downloadSkillKit() {
  let plan = latestInstallationPlan();
  if (!plan) throw new Error("请先生成安装计划");
  if (["draft", "partial", "failed", "cancelled"].includes(plan.status)) {
    plan = await saveInstallationPlan({ silent: true });
  }
  const response = await api(`/api/workflows/${encodeURIComponent(state.activeWorkflow.id)}/skill-kit?planId=${encodeURIComponent(plan.id)}`);
  downloadBlob(await response.blob(), "capability-atlas.skill-kit.json");
  toast("项目 Skill Kit 已下载；清单不包含本机路径或执行命令");
}

async function previewSkillKit(file) {
  if (!file) return;
  if (file.size > 512 * 1024) throw new Error("Skill Kit 超过 512 KB 上限");
  let kit;
  try {
    kit = JSON.parse(await file.text());
  } catch {
    throw new Error("Skill Kit 不是有效 JSON");
  }
  const preview = await (await api(`/api/workflows/${encodeURIComponent(state.activeWorkflow.id)}/skill-kit/preview`, {
    method: "POST",
    body: JSON.stringify({ kit }),
  })).json();
  state.installation.kitPreview = preview;
  state.installation.kitFileName = file.name.slice(0, 180);
  renderInstallationDialog();
  toast(`Kit 核对完成：${preview.summary.ready}/${preview.summary.total} 项指纹一致，未执行任何写入`);
}

function installationFormState(plan) {
  const selectedItemIds = [];
  const itemOptions = {};
  for (const card of elements.installationReceipt.querySelectorAll(".installation-item")) {
    const itemId = card.dataset.itemId;
    const selected = card.querySelector(".install-item-select")?.checked;
    if (selected) selectedItemIds.push(itemId);
    const acknowledgements = [...card.querySelectorAll(".install-risk-ack:checked")]
      .map((input) => input.dataset.risk)
      .filter((risk) => risk !== "reinstall-latest");
    itemOptions[itemId] = {
      acknowledgements,
      conflictResolution: card.querySelector(".install-conflict-resolution")?.value,
      renameTo: card.querySelector(".install-rename-to")?.value,
      reinstallLatest: card.querySelector('[data-risk="reinstall-latest"]')?.checked === true,
    };
  }
  return { planId: plan.id, selectedItemIds, itemOptions };
}

async function saveInstallationPlan({ silent = false } = {}) {
  const plan = latestInstallationPlan();
  if (!plan) throw new Error("尚未生成安装计划");
  const form = installationFormState(plan);
  const payload = await (await api(`/api/workflows/${encodeURIComponent(state.activeWorkflow.id)}/install-plans/${encodeURIComponent(plan.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      expectedRevision: state.activeWorkflow.revision,
      selectedItemIds: form.selectedItemIds,
      itemOptions: form.itemOptions,
    }),
  })).json();
  applyWorkflow(payload.workflow);
  renderInstallationDialog();
  if (!silent) toast("安装选择与风险确认已保存；尚未执行写入");
  return payload.plan;
}

async function executeInstallationPlan() {
  const saved = await saveInstallationPlan({ silent: true });
  const selected = saved.items.filter((item) => item.selected);
  if (!selected.length) throw new Error("请至少选择一个项目");
  if (!window.confirm(`即将执行 ${selected.length} 个 Skill 项目。成功项会保留，失败项独立回滚；确认继续？`)) return;
  const job = await (await api(`/api/workflows/${encodeURIComponent(state.activeWorkflow.id)}/install-plans/${encodeURIComponent(saved.id)}/execute`, {
    method: "POST",
    body: JSON.stringify({ expectedRevision: state.activeWorkflow.revision }),
  })).json();
  await openWorkflow(state.activeWorkflow.id, { assess: false });
  await fetchInstallationStatus();
  renderInstallationDialog();
  toast(`安装事务已进入队列：${job.jobId.slice(0, 8)}`);
}

async function cancelInstallationJob() {
  const job = state.installation.status?.activeJob;
  if (!job) throw new Error("当前没有可取消的安装事务");
  if (!window.confirm("立即终止子进程并回滚本次创建的托管路径？")) return;
  await api(`/api/installations/jobs/${encodeURIComponent(job.id)}/cancel`, { method: "POST", body: "{}" });
  await fetchInstallationStatus();
  renderInstallationDialog();
  toast("正在终止并清理安装事务");
}

async function acknowledgeInstallationWarnings(itemIds) {
  const plan = latestInstallationPlan();
  const payload = await (await api(`/api/workflows/${encodeURIComponent(state.activeWorkflow.id)}/install-plans/${encodeURIComponent(plan.id)}/acknowledge`, {
    method: "POST",
    body: JSON.stringify({ expectedRevision: state.activeWorkflow.revision, itemIds }),
  })).json();
  applyWorkflow(payload.workflow);
  renderInstallationDialog();
  toast("安全警告已逐项记录为人工审阅");
}

async function quarantineInstallationItem(itemId) {
  const plan = latestInstallationPlan();
  if (!window.confirm("断开 Capability Atlas 创建的 Agent 链接，并将托管来源移入隔离区？原始本地 Skill 不会删除。")) return;
  const payload = await (await api(`/api/workflows/${encodeURIComponent(state.activeWorkflow.id)}/install-plans/${encodeURIComponent(plan.id)}/items/${encodeURIComponent(itemId)}/quarantine`, {
    method: "POST",
    body: JSON.stringify({ expectedRevision: state.activeWorkflow.revision }),
  })).json();
  applyWorkflow(payload.workflow);
  await scan({ refresh: true });
  await generatePlan({ preserveSelection: true });
  await fetchInstallationStatus();
  renderInstallationDialog();
  toast("托管路径已断开，来源已按所有权规则处理");
}

async function resolveInstallationRepair(action) {
  if (!window.confirm("这是安装恢复操作。请确认你已检查回执单中的残留路径和上次事务状态。")) return;
  await api("/api/installations/repair", { method: "POST", body: JSON.stringify({ action }) });
  await fetchInstallationStatus();
  if (state.activeWorkflow) await openWorkflow(state.activeWorkflow.id, { assess: false });
  renderInstallationDialog();
  toast("安装事务锁已解除");
}

async function scan({ refresh = false, roots = customRoots() } = {}) {
  setBusy(true, "正在只读扫描本机 Agent Skill 目录……");
  try {
    state.inventory = await (await api("/api/scan", {
      method: "POST",
      body: JSON.stringify({ refresh, customRoots: roots }),
    })).json();
    renderInventory();
  } finally {
    setBusy(false);
  }
}

function renderNoWorkflow() {
  state.plan = null;
  state.selectedStageId = null;
  elements.subtitle.textContent = "等待 MCP Agent 提交工作流";
  renderAssumptions();
  renderCounter();
  elements.stages.replaceChildren(node("div", {
    className: "no-candidates",
    text: "尚无可评估的工作流。通过 MCP 创建草案后，可在左侧选择并查看能力覆盖。",
  }));
  elements.inspector.replaceChildren(node("div", { className: "empty-inspector" }, [
    node("div", { className: "empty-compass", attributes: { "aria-hidden": "true" } }, [node("span")]),
    node("p", { className: "eyebrow", text: "Workflow desk" }),
    node("h2", { text: "等待工作流" }),
    node("p", { text: "选择一份工作流后，这里会展示阶段能力、匹配证据和缺口。" }),
  ]));
  renderWorkflowPicker();
  renderWorkflowState();
  persistWorkspace({ silent: true });
}

async function generatePlan({ preserveSelection = false } = {}) {
  if (!state.activeWorkflow) {
    renderNoWorkflow();
    return;
  }
  setBusy(true, "正在将本机能力匹配到专家参考流程……");
  try {
    state.plan = await (await api("/api/plan", {
      method: "POST",
      body: JSON.stringify({ workflowId: state.activeWorkflow.id }),
    })).json();
    if (!preserveSelection || !state.plan.stages.some((stage) => stage.id === state.selectedStageId)) {
      state.selectedStageId = state.plan.stages[0]?.id || null;
    }
    elements.subtitle.textContent = `${state.plan.goal} · ${state.plan.template.name} v${state.plan.template.version}`;
    renderAssumptions();
    renderCounter();
    renderStages();
    renderInspector();
    renderWorkflowState();
    persistWorkspace({ silent: true });
    if (elements.catalogDialog.open) renderCatalog();
  } finally {
    setBusy(false);
  }
}

async function downloadMarkdown() {
  if (!state.activeWorkflow) throw new Error("请先选择一份工作流");
  setBusy(true);
  try {
    const response = await api("/api/export", {
      method: "POST",
      body: JSON.stringify({ workflowId: state.activeWorkflow.id, format: "markdown" }),
    });
    downloadBlob(await response.blob(), "capability-map.md", "text/markdown");
    toast("Markdown 能力地图已导出");
  } finally {
    setBusy(false);
  }
}

playbookUi = createPlaybookUi({
  api,
  getWorkflow: () => state.activeWorkflow,
  toast,
});

elements.workflowSelect.addEventListener("change", handle(async () => {
  const workflowId = elements.workflowSelect.value;
  if (!workflowId || workflowId === state.activeWorkflow?.id) return;
  persistWorkspace({ silent: true });
  await openWorkflow(workflowId, { assess: true, announce: true });
  await fetchWorkflowList();
}));

elements.rescan.addEventListener("click", handle(async () => {
  await scan({ refresh: true });
  await generatePlan({ preserveSelection: true });
  toast("本机 Skill 已重新扫描");
}));
elements.exportMarkdown.addEventListener("click", handle(downloadMarkdown));
elements.exportJson.addEventListener("click", handle(downloadWorkspace));

elements.installationPlanButton.addEventListener("click", handle(() => openInstallationDialog()));
elements.editWorkflowDefinition.addEventListener("click", handle(openWorkflowDefinitionDialog));
elements.closeWorkflowDefinition.addEventListener("click", closeWorkflowDefinitionDialog);
elements.cancelWorkflowDefinition.addEventListener("click", closeWorkflowDefinitionDialog);
for (const input of [elements.workflowScopeDescription, elements.workflowNonGoals, elements.workflowAcceptanceCriteria]) {
  input.addEventListener("input", () => input.setCustomValidity(""));
}
elements.workflowDefinitionForm.addEventListener("submit", handle(async (event) => {
  event.preventDefault();
  if (!state.activeWorkflow) throw new Error("尚无可编辑的共享工作流");
  const patch = {
    scopeDescription: elements.workflowScopeDescription.value.trim(),
    nonGoals: parseWorkflowListInput(elements.workflowNonGoals.value),
    acceptanceCriteria: parseWorkflowListInput(elements.workflowAcceptanceCriteria.value),
  };
  const missing = missingWorkflowConfirmationFields(patch);
  const controls = [
    ["包含范围", elements.workflowScopeDescription],
    ["明确不做", elements.workflowNonGoals],
    ["验收标准", elements.workflowAcceptanceCriteria],
  ];
  const invalid = controls.find(([label]) => missing.includes(label));
  if (invalid) {
    invalid[1].setCustomValidity(`请填写${invalid[0]}`);
    invalid[1].reportValidity();
    return;
  }
  setBusy(true, "正在保存工作流确认信息……");
  const workflow = await (await api(`/api/workflows/${encodeURIComponent(state.activeWorkflow.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ expectedRevision: state.activeWorkflow.revision, patch }),
  })).json();
  applyWorkflow(workflow);
  await fetchWorkflowList();
  await generatePlan({ preserveSelection: true });
  closeWorkflowDefinitionDialog();
  toast("确认信息已保存，现在可以人工确认当前版本");
}));
elements.createInstallationPlan.addEventListener("click", handle(createInstallationPlan));
elements.skillKitExport.addEventListener("click", handle(downloadSkillKit));
elements.skillKitImport.addEventListener("change", handle(async () => {
  const [file] = elements.skillKitImport.files;
  try {
    await previewSkillKit(file);
  } finally {
    elements.skillKitImport.value = "";
  }
}));
elements.saveInstallationPlan.addEventListener("click", handle(() => saveInstallationPlan()));
elements.executeInstallationPlan.addEventListener("click", handle(executeInstallationPlan));
elements.cancelInstallationJob.addEventListener("click", handle(cancelInstallationJob));
elements.installationDialog.addEventListener("close", () => {
  state.installation.focusItemId = null;
});

function openCatalogDialog() {
  state.catalog.limit = 100;
  resetCatalogScroll();
  syncCatalogUrl();
  renderCatalog();
  if (!elements.catalogDialog.open) elements.catalogDialog.showModal();
  elements.catalogSearch.focus();
}

elements.catalogButton.addEventListener("click", openCatalogDialog);
elements.catalogLocalTab.addEventListener("click", () => setCatalogMode("local"));
elements.catalogEcosystemTab.addEventListener("click", () => setCatalogMode("ecosystem"));
for (const tab of [elements.catalogLocalTab, elements.catalogEcosystemTab]) {
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    setCatalogMode(state.catalog.mode === "local" ? "ecosystem" : "local");
  });
}

let catalogSearchTimer;
elements.catalogSearch.addEventListener("input", () => {
  resetEcosystemComparison();
  resetEcosystemDocument();
  state.catalog.limit = 100;
  state.catalog.selectedKey = null;
  syncCatalogUrl();
  clearTimeout(catalogSearchTimer);
  if (state.catalog.mode === "local") {
    renderCatalog();
    return;
  }
  catalogSearchTimer = setTimeout(renderCatalog, 220);
});
for (const control of [elements.catalogProvider, elements.catalogIssue, elements.catalogView]) {
  control.addEventListener("change", () => {
    resetEcosystemComparison();
    resetEcosystemDocument();
    state.catalog.limit = 100;
    state.catalog.selectedKey = null;
    syncCatalogUrl();
    renderCatalog();
  });
}
for (const [control, key] of [
  [elements.catalogEcosystemCategory, "category"],
  [elements.catalogEcosystemSource, "source"],
  [elements.catalogEcosystemChain, "chain"],
  [elements.catalogEcosystemSort, "sort"],
]) {
  control.addEventListener("change", () => {
    resetEcosystemComparison();
    resetEcosystemDocument();
    ecosystemFilters()[key] = control.value;
    state.catalog.limit = 100;
    state.catalog.selectedKey = null;
    syncCatalogUrl();
    renderCatalog();
  });
}
elements.catalogShare.addEventListener("click", () => {
  const url = syncCatalogUrl();
  copyText(url.href, "查询链接已复制");
});
elements.catalogRefresh.addEventListener("click", () => {
  resetEcosystemComparison({ clearCache: true });
  state.catalog.selectedKey = null;
  renderCatalog({ refresh: true });
});
elements.catalogMore.addEventListener("click", () => {
  state.catalog.limit = Math.min(500, state.catalog.limit + 100);
  renderCatalog();
});
elements.catalogDialog.addEventListener("close", clearCatalogUrl);
document.addEventListener("keydown", (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== "k") return;
  event.preventDefault();
  if (elements.catalogDialog.open) {
    elements.catalogSearch.focus();
    return;
  }
  if (document.querySelector("dialog[open]")) return;
  openCatalogDialog();
});

elements.workspaceButton.addEventListener("click", () => {
  renderWorkspaceDialog();
  elements.workspaceDialog.showModal();
});
elements.saveRoots.addEventListener("click", handle(async () => {
  const roots = [...new Set(elements.customRoots.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
  if (roots.length > 20) throw new Error("最多添加 20 个自定义目录");
  // The server owns path validation. Save only after a successful read-only scan.
  await scan({ refresh: true, roots });
  await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ customRoots: roots }),
  });
  state.workspace.customRoots = roots;
  persistWorkspace();
  await generatePlan({ preserveSelection: true });
  renderWorkspaceDialog();
  toast("扫描目录已保存并重新扫描");
}));
elements.backupWorkspace.addEventListener("click", handle(downloadWorkspace));
elements.restoreWorkspace.addEventListener("change", handle(async () => {
  const [file] = elements.restoreWorkspace.files;
  await restoreWorkspace(file);
  elements.restoreWorkspace.value = "";
}));
elements.resetReviews.addEventListener("click", handle(async () => {
  if (!Object.keys(state.overrides).length) {
    toast("当前地图还没有人工判断");
    return;
  }
  if (!window.confirm("清空当前地图的全部确认和排除判断？")) return;
  if (state.activeWorkflow) {
    const workflow = await (await api(`/api/workflows/${encodeURIComponent(state.activeWorkflow.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        expectedRevision: state.activeWorkflow.revision,
        patch: { reviews: {} },
      }),
    })).json();
    applyWorkflow(workflow);
    await fetchWorkflowList();
  }
  state.overrides = {};
  persistWorkspace();
  await generatePlan({ preserveSelection: true });
  renderWorkspaceDialog();
  toast("当前地图的人工判断已清空");
}));

elements.confirmWorkflow.addEventListener("click", handle(async () => {
  if (!state.activeWorkflow) throw new Error("尚无可确认的共享工作流");
  const missing = missingWorkflowConfirmationFields(state.activeWorkflow);
  if (missing.length) throw new Error(`人工确认前请补齐：${missing.join("、")}`);
  if (!window.confirm("确认当前工作流、能力项和 Skill 判断为一个不可变人工版本？后续修改会创建新草案。")) return;
  const workflow = await (await api(`/api/workflows/${encodeURIComponent(state.activeWorkflow.id)}/confirm`, {
    method: "POST",
    body: JSON.stringify({ expectedRevision: state.activeWorkflow.revision }),
  })).json();
  applyWorkflow(workflow);
  await openWorkflow(workflow.id, { assess: true });
  await fetchWorkflowList();
  toast(`已保存人工确认版本 v${workflow.confirmedVersion}`);
}));

async function boot() {
  applyActiveMap();
  const openSharedCatalog = restoreCatalogFromUrl();
  renderWorkspaceDialog();
  try {
    const settings = await (await api("/api/settings")).json();
    if (!(settings.customRoots || []).length && customRoots().length) {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ customRoots: customRoots() }),
      });
    } else {
      state.workspace.customRoots = settings.customRoots || [];
      persistWorkspace({ silent: true });
    }
    await scan();
    const workflows = await fetchWorkflowList();
    const preferred = workflows.find((workflow) => workflow.id === state.workspace.activeWorkflowId) || workflows[0];
    if (preferred) await openWorkflow(preferred.id, { assess: true });
    else renderNoWorkflow();
    if (openSharedCatalog) openCatalogDialog();
    setInterval(pollWorkflowUpdates, 3_000);
  } catch (error) {
    console.error(error);
    elements.subtitle.textContent = "无法生成地图";
    elements.stages.replaceChildren(node("div", {
      className: "no-candidates",
      text: `启动失败：${error.message}。检查 Node 服务是否仍在运行，或在工作区移除不可访问的自定义目录。`,
    }));
    toast(`启动失败：${error.message}`);
    setBusy(false);
  }
}

boot();
