import { App } from "@modelcontextprotocol/ext-apps";
import { buildSkillHandoff } from "../lib/quick-skill-deck.mjs";
import { runUiMessageHandoff } from "../lib/ui-message-handoff.mjs";

const app = new App({ name: "SkillMesh Workbench", version: "0.9.0" }, {
  availableDisplayModes: ["inline", "fullscreen"],
});
const byId = (id) => document.getElementById(id);
const elements = Object.fromEntries([
  "context-summary", "host-badge", "expand-app", "workflow-select", "stage-select", "target-options",
  "refresh-app", "status", "panel-map", "panel-plan", "panel-quick", "panel-install", "panel-settings",
  "composer", "composer-source", "composer-title", "composer-description", "close-composer", "use-form",
  "task", "outputs", "form-error", "send", "send-note",
].map((id) => [id.replaceAll("-", "_"), byId(id)]));

let snapshot = null;
let selectedTargets = [];
let selectedSkill = null;
let connected = false;
let busy = false;
let pollingTimer = null;
let executionArmedFor = null;
let composerReturnFocus = null;
const externalReviewPreviews = new Map();

function text(value) { return String(value ?? ""); }
function unique(values) { return [...new Set((values || []).map((item) => text(item).trim()).filter(Boolean))]; }

function node(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.textContent !== undefined) element.textContent = text(options.textContent);
  for (const [name, value] of Object.entries(options.attributes || {})) {
    if (value !== undefined && value !== null) element.setAttribute(name, text(value));
  }
  if (options.disabled) element.disabled = true;
  for (const child of Array.isArray(children) ? children : [children]) if (child) element.append(child);
  return element;
}

function action(label, onClick, { className = "quiet compact", disabled = false, title = "" } = {}) {
  const button = node("button", { className, textContent: label, attributes: { type: "button", title }, disabled });
  button.addEventListener("click", onClick);
  return button;
}

function structured(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const block = result?.content?.find?.((item) => item.type === "text");
  if (!block?.text) return null;
  try { return JSON.parse(block.text); } catch { return null; }
}

function errorMessage(error, fallback = "操作失败") {
  const value = text(error?.message || error);
  try {
    const parsed = JSON.parse(value);
    return parsed.message || parsed.error || value;
  } catch {
    return value.replace(/^MCP error -?\d+:\s*/u, "") || fallback;
  }
}

function setStatus(message = "", tone = "") {
  elements.status.textContent = message;
  elements.status.className = `status${tone ? ` ${tone}` : ""}`;
}

function hostCapabilities() { return connected ? app.getHostCapabilities() || {} : {}; }
function appReadOnly() { return snapshot?.featurePolicy?.readOnly !== false; }
function canMutate() { return connected && Boolean(hostCapabilities().serverTools) && !appReadOnly(); }
function canMessage() { return connected && Boolean(hostCapabilities().message) && !appReadOnly(); }
function canDownload() { return connected && Boolean(hostCapabilities().downloadFile); }

async function callTool(name, arguments_ = {}) {
  if (!connected || !hostCapabilities().serverTools) throw new Error("当前宿主未提供 MCP Apps serverTools 能力");
  const response = await app.callServerTool({ name, arguments: arguments_ });
  if (response?.isError) {
    throw new Error(response.content?.find?.((item) => item.type === "text")?.text || `${name} 调用失败`);
  }
  return response;
}

function currentContext() {
  return {
    workflowId: snapshot?.workflows?.activeId || undefined,
    stageId: snapshot?.workflows?.activeStageId || undefined,
    targetAgents: selectedTargets.length ? selectedTargets : undefined,
  };
}

async function refreshSnapshot({ refresh = false, announce = true, context = {} } = {}) {
  if (announce) setStatus(refresh ? "正在重新扫描本机 Skill…" : "正在刷新工作台…");
  const response = await callTool("get_skillmesh_app_snapshot", {
    ...currentContext(),
    ...context,
    refresh,
  });
  acceptSnapshot(structured(response));
  if (announce) setStatus(refresh ? "扫描完成，工作台已更新。" : "工作台已更新。");
}

async function mutate(name, arguments_, success, { refresh = true } = {}) {
  if (busy) return null;
  busy = true;
  setStatus("正在保存…");
  try {
    const response = await callTool(name, arguments_);
    if (refresh) await refreshSnapshot({ refresh: false, announce: false });
    setStatus(success);
    return structured(response);
  } catch (error) {
    const message = errorMessage(error);
    setStatus(message, /conflict|revision|changed|stale/u.test(message) ? "warning" : "error");
    if (/conflict|revision|changed|stale/u.test(message)) {
      await refreshSnapshot({ refresh: false, announce: false }).catch(() => {});
    }
    return null;
  } finally {
    busy = false;
  }
}

function metric(value, label) {
  return node("div", { className: "stat" }, [node("strong", { textContent: value ?? 0 }), node("span", { textContent: label })]);
}

function panelHeading(title, description, actions = []) {
  return node("header", { className: "panel-head" }, [
    node("div", {}, [node("h2", { textContent: title }), node("p", { textContent: description })]),
    node("div", { className: "action-row" }, actions),
  ]);
}

function renderControls() {
  const workflows = snapshot?.workflows?.items || [];
  elements.workflow_select.replaceChildren(node("option", {
    textContent: workflows.length ? "选择工作流" : "暂无工作流",
    attributes: { value: "" },
  }));
  for (const workflow of workflows) {
    elements.workflow_select.append(node("option", { textContent: workflow.title, attributes: { value: workflow.id } }));
  }
  elements.workflow_select.value = snapshot?.workflows?.activeId || "";
  elements.workflow_select.disabled = !workflows.length || !connected || !hostCapabilities().serverTools;

  const workflow = workflows.find((item) => item.id === elements.workflow_select.value);
  elements.stage_select.replaceChildren(node("option", {
    textContent: workflow?.stages?.length ? "选择阶段" : "暂无阶段",
    attributes: { value: "" },
  }));
  for (const stage of workflow?.stages || []) {
    elements.stage_select.append(node("option", { textContent: stage.title, attributes: { value: stage.id } }));
  }
  elements.stage_select.value = snapshot?.workflows?.activeStageId || "";
  elements.stage_select.disabled = !workflow?.stages?.length || !connected || !hostCapabilities().serverTools;

  const availableTargets = snapshot?.installation?.global?.targets || [];
  if (!selectedTargets.length) {
    selectedTargets = (snapshot?.skillPlan?.mappingScope?.targetAgents || []).map((target) => target.id);
  }
  elements.target_options.replaceChildren(node("legend", { textContent: "测绘目标 Agent" }));
  for (const target of availableTargets) {
    const checkbox = node("input", { attributes: { type: "checkbox", value: target.id } });
    checkbox.checked = selectedTargets.includes(target.id);
    checkbox.disabled = !connected || !hostCapabilities().serverTools;
    checkbox.addEventListener("change", async () => {
      const checked = [...elements.target_options.querySelectorAll('input[type="checkbox"]:checked')].map((item) => item.value);
      if (!checked.length) {
        checkbox.checked = true;
        setStatus("至少保留一个测绘目标 Agent。", "warning");
        return;
      }
      selectedTargets = checked;
      await refreshSnapshot({ context: { targetAgents: selectedTargets } }).catch((error) => setStatus(errorMessage(error), "error"));
    });
    elements.target_options.append(node("label", {}, [checkbox, document.createTextNode(target.label)]));
  }
}

function decisionLabel(value) {
  return ({ confirmed: "已确认", partial: "部分覆盖", excluded: "已排除", unreviewed: "待判断" })[value] || "待判断";
}

function renderCandidate(stage, candidate, revision) {
  const rationale = node("textarea", {
    attributes: { rows: "2", placeholder: "判断依据（可选）", "aria-label": `${candidate.name} 判断依据` },
  });
  const review = async (decision) => mutate("review_skill_match", {
    kind: "local",
    workflowId: snapshot.workflow.id,
    expectedRevision: revision,
    stageId: stage.id,
    contentHash: candidate.contentHash,
    decision,
    rationale: rationale.value,
  }, `已将 ${candidate.name} 标记为${decisionLabel(decision)}。`);
  const controlsDisabled = !canMutate();
  const actions = node("div", { className: "candidate-actions" }, [
    action("确认", () => review("confirmed"), { disabled: controlsDisabled }),
    action("部分", () => review("partial"), { disabled: controlsDisabled }),
    action("排除", () => review("excluded"), { className: "danger compact", disabled: controlsDisabled }),
    action("清除", () => review("unreviewed"), { disabled: controlsDisabled }),
  ]);
  const validation = node("details", {}, [node("summary", { textContent: "记录人工运行验证" })]);
  const validationForm = node("form", { className: "item-options" }, [
    node("label", { textContent: "运行环境" }, [node("input", { attributes: { name: "environment", required: "", placeholder: "例如：macOS 15 / 当前仓库" } })]),
    node("label", { textContent: "Skill 版本" }, [node("input", { attributes: { name: "skillVersion", placeholder: "可选" } })]),
    node("label", { textContent: "验证说明" }, [node("textarea", { attributes: { name: "notes", rows: "2", required: "", placeholder: "记录实际运行结果与限制" } })]),
    node("div", { className: "action-row" }, [action("保存验证", async () => {
      const environment = validationForm.elements.environment.value.trim();
      const notes = validationForm.elements.notes.value.trim();
      if (!environment || !notes) {
        setStatus("运行环境和验证说明不能为空。", "warning");
        return;
      }
      await mutate("record_skill_validation", {
        workflowId: snapshot.workflow.id,
        expectedRevision: snapshot.workflow.revision,
        contentHash: candidate.contentHash,
        agent: snapshot.host.label,
        environment,
        skillVersion: validationForm.elements.skillVersion.value,
        notes,
      }, `已记录 ${candidate.name} 的人工验证。`);
    }, { className: "primary compact", disabled: controlsDisabled })]),
  ]);
  validation.append(validationForm);
  return node("article", { className: "candidate" }, [
    node("div", { className: "action-row" }, [
      node("h4", { textContent: candidate.name }),
      node("span", { className: "pill", textContent: decisionLabel(candidate.decision) }),
    ]),
    node("p", { textContent: candidate.description || "未提供作用说明" }),
    node("p", { className: "metadata", textContent: `匹配 ${Math.round((candidate.score || 0) * 100)}% · 置信 ${Math.round((candidate.confidence || 0) * 100)}% · ${candidate.providers?.join(" / ") || candidate.provider}` }),
    ...(candidate.warnings?.length ? [node("p", { className: "metadata", textContent: `注意：${candidate.warnings.join("；")}` })] : []),
    rationale,
    actions,
    validation,
  ]);
}

function renderMap() {
  const panel = elements.panel_map;
  const workflow = snapshot?.workflow;
  const assessment = snapshot?.assessment;
  if (!workflow || !assessment) {
    panel.replaceChildren(panelHeading("工作流测绘", "选择工作流后查看本机 Skill 证据并完成人工判断。"), node("div", { className: "empty", textContent: "当前没有选中的工作流。请先让 Agent 创建工作流草案，或在上方选择已有工作流。" }));
    return;
  }
  const summary = assessment.summary || {};
  const body = [
    panelHeading("工作流测绘", "证据来自本机 Skill 元数据与工作流能力；确认仅代表人工判断，不代表运行验证。"),
    node("div", { className: "stat-strip" }, [
      metric(`${Math.round((summary.coverageRatio || 0) * 100)}%`, "证据覆盖"),
      metric(`${Math.round((summary.confirmedCoverageRatio || 0) * 100)}%`, "人工确认覆盖"),
      metric(summary.missingRequiredCapabilities || 0, "缺失能力"),
      metric(workflow.revision, "工作流修订"),
    ]),
  ];
  const stages = node("div", { className: "stage-list" });
  for (const stage of assessment.stages || []) {
    const candidateGrid = node("div", { className: "candidate-grid" });
    for (const candidate of (stage.candidates || []).slice(0, 8)) candidateGrid.append(renderCandidate(stage, candidate, workflow.revision));
    const capabilityList = node("ul", { className: "capability-list" }, (stage.capabilityCoverage || []).map((capability) =>
      node("li", { textContent: `${capability.label} · ${decisionLabel(capability.status)} · ${capability.candidateCount || 0} 个候选` })));
    stages.append(node("article", { className: "stage-card" }, [
      node("header", {}, [node("div", {}, [node("p", { className: "eyebrow", textContent: stage.phase || "工作流阶段" }), node("h3", { textContent: stage.title })]), node("span", { className: "pill", textContent: stage.status || "待评估" })]),
      node("p", { textContent: stage.summary || stage.description || "" }),
      capabilityList,
      candidateGrid.childElementCount ? candidateGrid : node("div", { className: "empty", textContent: "此阶段暂无线索候选。" }),
    ]));
  }
  body.push(stages);

  const scope = node("textarea", { attributes: { rows: "3" } });
  scope.value = workflow.scopeDescription || "";
  const nonGoals = node("textarea", { attributes: { rows: "3", placeholder: "每行一项" } });
  nonGoals.value = (workflow.nonGoals || []).join("\n");
  const acceptance = node("textarea", { attributes: { rows: "3", placeholder: "每行一项" } });
  acceptance.value = (workflow.acceptanceCriteria || []).join("\n");
  const confirmationCard = node("article", { className: "settings-card" }, [
    node("div", {}, [node("h3", { textContent: "工作流确认" }), node("p", { textContent: "保存确认元数据后，由用户创建不可变确认版本。" })]),
    node("label", { textContent: "范围说明" }, [scope]),
    node("label", { textContent: "非目标" }, [nonGoals]),
    node("label", { textContent: "验收标准" }, [acceptance]),
    node("div", { className: "action-row" }, [
      action("保存确认信息", () => mutate("update_workflow_confirmation_fields", {
        workflowId: workflow.id,
        expectedRevision: workflow.revision,
        scopeDescription: scope.value,
        nonGoals: unique(nonGoals.value.split(/\r?\n/u)),
        acceptanceCriteria: unique(acceptance.value.split(/\r?\n/u)),
      }, "工作流确认信息已保存。"), { disabled: !canMutate() }),
      action("确认当前版本", () => mutate("confirm_workflow", {
        workflowId: workflow.id,
        expectedRevision: workflow.revision,
      }, "工作流已创建新的人工确认版本。"), { className: "primary", disabled: !canMutate() }),
    ]),
  ]);
  body.push(confirmationCard);
  panel.replaceChildren(...body);
}

function bindingBlock(binding, label, alternative = false) {
  return node("div", { className: `binding${alternative ? " alternative" : ""}` }, [
    node("strong", { textContent: `${label} · ${binding?.name || "未命名 Skill"}` }),
    node("small", { textContent: `${binding?.reviewStatus === "confirmed" ? "已确认" : "待确认"} · ${binding?.readiness || "未验证"}` }),
    node("p", { textContent: binding?.rationale || "" }),
    ...(binding?.responsibilities?.length ? [node("div", { className: "route-meta" }, binding.responsibilities.map((item) => node("span", { className: "pill", textContent: item })))] : []),
  ]);
}

function useItemFromCard(card, targetPlan) {
  return {
    ...card.primary,
    source: "current",
    stageTitle: card.stageTitle,
    stepTitle: card.stepTitle,
    taskSuggestion: card.objective,
    expectedOutputs: ["完成结果", "验收说明"],
    acceptanceCriteria: card.completionCriteria || [],
    invocationPrompt: card.primary?.invocationPrompt || "",
    targetAgent: targetPlan.targetAgent,
    planContentHash: snapshot.skillPlan?.contentHash || "",
  };
}

function renderPlan() {
  const panel = elements.panel_plan;
  const plan = snapshot?.skillPlan;
  if (!plan) {
    panel.replaceChildren(panelHeading("Skill 使用方案", "选择工作流后即时扫描并生成只读方案。"), node("div", { className: "empty", textContent: "尚无可显示方案。" }));
    return;
  }
  const exportActions = ["markdown", "pdf"].map((format) => action(format === "markdown" ? "下载 Markdown" : "下载 PDF", () => downloadPlan(format), {
    disabled: !canDownload(),
    title: canDownload() ? "" : "当前宿主不支持 ui/downloadFile",
  }));
  const body = [
    panelHeading("Skill 使用方案", "方案由工作流、人工判断和最新本机清单确定性计算；生成时间不参与内容哈希。", exportActions),
    node("div", { className: "stat-strip" }, [
      metric(({ quick: "精简", standard: "标准", full: "完整" })[plan.planningDepth] || plan.planningDepth, "自动深度"),
      metric(plan.summaryCounts?.trustedSkillCount || 0, "可信主 Skill"),
      metric(plan.summaryCounts?.cardCount || 0, "路线步骤"),
      metric(plan.summaryCounts?.gapCount || 0, "能力缺口"),
    ]),
  ];
  for (const targetPlan of plan.targetPlans || []) {
    const gaps = targetPlan.gaps || [];
    const targetSection = node("section", { className: "stage-list" }, [
      node("header", { className: "panel-head" }, [node("div", {}, [node("p", { className: "eyebrow", textContent: targetPlan.targetAgent?.current ? "当前宿主" : "测绘目标" }), node("h3", { textContent: targetPlan.targetAgent?.label || targetPlan.targetAgent?.id })])]),
    ]);
    if (gaps.length) {
      targetSection.append(node("div", { className: "gap-board" }, [
        node("strong", { textContent: `${gaps.length} 项能力需要处理` }),
        node("ul", {}, gaps.map((gap) => node("li", { textContent: `${gap.label} · ${gap.stepTitle} · ${gap.availability || gap.status}` }))),
      ]));
    }
    const route = node("div", { className: "route" });
    for (const stage of targetPlan.stages || []) {
      for (const card of stage.cards || []) {
        const cardNode = node("article", { className: "skill-card route-card", attributes: { "data-order": String(card.order || "•").padStart(2, "0") } }, [
          node("header", {}, [node("div", {}, [node("p", { className: "eyebrow", textContent: `${stage.title} · ${card.stepTitle}` }), node("h3", { textContent: card.objective || card.stepTitle })]), action("使用主 Skill", () => openComposer(useItemFromCard(card, targetPlan)), { className: "primary compact", disabled: !canMessage() || targetPlan.targetAgent?.id !== snapshot.host.currentAgent })]),
          bindingBlock(card.primary, "主 Skill"),
          ...(card.supportingSkills || []).map((item) => bindingBlock(item, "协作 Skill")),
          ...(card.alternatives || []).map((item) => bindingBlock(item, "待确认备选", true)),
          node("h4", { textContent: "使用到什么程度" }),
          node("ul", { className: "criteria" }, (card.completionCriteria || []).map((item) => node("li", { textContent: item }))),
        ]);
        route.append(cardNode);
      }
    }
    targetSection.append(route.childElementCount ? route : node("div", { className: "empty", textContent: "当前目标没有达到可信门槛的主 Skill；请先处理能力缺口或完成判断。" }));
    body.push(targetSection);
  }
  body.push(node("p", { className: "metadata", textContent: `内容哈希 ${plan.contentHash} · Skill 清单 ${plan.inventoryGeneratedAt || plan.source?.inventoryGeneratedAt || "未知"}` }));
  panel.replaceChildren(...body);
}

function quickSource(item) {
  if (item.source === "current") return item.stepTitle ? `当前步骤 · ${item.stepTitle}` : "当前阶段相关";
  return item.source === "favorite" ? "收藏" : "最近使用";
}

function renderQuickCard(item) {
  const favorites = new Set(snapshot.quickUse?.state?.favorites || []);
  const favorite = favorites.has(item.contentHash);
  return node("article", { className: "skill-card" }, [
    node("header", {}, [node("span", { className: "pill", textContent: quickSource(item) }), action(favorite ? "★" : "☆", () => updatePreference({ type: "set-favorite", contentHash: item.contentHash, favorite: !favorite }), { className: "favorite", disabled: !canMutate(), title: favorite ? "取消收藏" : "收藏" })]),
    node("h3", { textContent: item.name }),
    node("p", { textContent: item.description || "未提供作用说明" }),
    ...(item.rationale ? [node("p", { className: "metadata", textContent: item.rationale })] : []),
    node("footer", {}, [node("span", { className: "metadata", textContent: snapshot.quickUse?.targetAgent?.label || "当前 Agent" }), action("使用", () => openComposer({ ...item, targetAgent: snapshot.quickUse?.targetAgent, planContentHash: snapshot.skillPlan?.contentHash || "" }), { className: "primary compact", disabled: !canMessage() })]),
  ]);
}

function renderQuickSection(title, description, section) {
  return node("section", { className: "deck-section" }, [
    node("header", {}, [node("div", {}, [node("h3", { textContent: title }), node("p", { textContent: description })]), node("span", { className: "count", textContent: section?.total || 0 })]),
    section?.items?.length ? node("div", { className: "cards" }, section.items.map(renderQuickCard)) : node("div", { className: "empty", textContent: `暂无${title} Skill。` }),
  ]);
}

function renderQuick() {
  const panel = elements.panel_quick;
  const deck = snapshot?.quickUse;
  if (!deck) {
    panel.replaceChildren(panelHeading("快速使用", "将结构化 Skill 指令发送到当前宿主对话。"), node("div", { className: "empty", textContent: "快速卡片尚未就绪。" }));
    return;
  }
  const capabilityNotice = canMessage()
    ? null
    : node("div", { className: "notice warning", textContent: appReadOnly() ? "当前宿主不是受支持的 WorkBuddy 或 Codex，工作台保持只读。" : "当前宿主没有声明 ui/message 能力，无法发送 Skill。" });
  panel.replaceChildren(
    panelHeading("快速使用", `只展示适用于当前 ${snapshot.host.label} 的阶段相关、收藏和最近 Skill。`),
    ...(capabilityNotice ? [capabilityNotice] : []),
    renderQuickSection("当前阶段相关", "来自当前阶段对应的 Skill 方案分组。", deck.sections.current),
    renderQuickSection("收藏", "跨工作流保留，但仍按当前宿主兼容性过滤。", deck.sections.favorites),
    renderQuickSection("最近使用", "仅在 ui/message 被宿主接受后写入。", deck.sections.recent),
  );
}

async function updatePreference(operation) {
  const updated = await mutate("update_skillmesh_preferences", {
    expectedRevision: snapshot.quickUse.preferenceRevision,
    operation,
  }, operation.type === "set-favorite" ? "收藏状态已同步。" : "工作流上下文已同步。", { refresh: false });
  if (!updated) return;
  await refreshSnapshot({
    refresh: false,
    announce: false,
    context: operation.type === "select-context" ? {
      workflowId: operation.workflowId || "",
      stageId: operation.stageId || "",
    } : {},
  });
}

async function selectContext(workflowId, stageId) {
  if (canMutate()) {
    await updatePreference({ type: "select-context", workflowId: workflowId || null, stageId: stageId || null });
    return;
  }
  await refreshSnapshot({
    refresh: false,
    context: { workflowId: workflowId || "", stageId: stageId || "" },
  }).catch((error) => setStatus(errorMessage(error), "error"));
}

function installRiskOption(item, riskFlag, acknowledgement, label) {
  if (!item.riskFlags?.includes(riskFlag)) return null;
  const checkbox = node("input", { attributes: { type: "checkbox", "data-ack": acknowledgement } });
  checkbox.checked = item.acknowledgements?.includes(acknowledgement);
  return node("label", {}, [checkbox, document.createTextNode(label)]);
}

function renderInstallItem(item) {
  const selected = node("input", { attributes: { type: "checkbox", class: "install-select", "data-item-id": item.id } });
  selected.checked = Boolean(item.selected);
  selected.disabled = ["installed", "installed-warning", "already-installed", "quarantined"].includes(item.status);
  const conflictSelect = node("select", { attributes: { class: "conflict-resolution", "data-item-id": item.id, "aria-label": `${item.name} 冲突处理` } }, [
    node("option", { textContent: "保留现有内容", attributes: { value: "keep" } }),
    node("option", { textContent: "替换现有内容", attributes: { value: "replace" } }),
    ...(item.type === "local-sync" ? [node("option", { textContent: "使用新名称", attributes: { value: "rename" } })] : []),
  ]);
  conflictSelect.value = item.conflict?.resolution || "keep";
  const rename = node("input", { attributes: { class: "rename-to", "data-item-id": item.id, placeholder: "新目录名" } });
  rename.value = item.conflict?.renameTo || "";
  const riskOptions = [
    installRiskOption(item, "pre-scan-visible", "pre-scan-visible", "我理解外部安装会先写入再扫描"),
    installRiskOption(item, "compatibility-override-required", "compatibility-override", "覆盖 Agent 兼容性声明"),
  ].filter(Boolean);
  return node("article", { className: "install-item", attributes: { "data-install-item": item.id } }, [
    node("label", {}, [selected, document.createTextNode(`${item.name} · ${item.status}`)]),
    node("p", { className: "metadata", textContent: `${item.type === "external-install" ? "生态安装" : "本机同步"} · ${item.targetAgents?.join(" / ") || "未选目标"}` }),
    ...(item.riskFlags?.length ? [node("ul", { className: "risk-list" }, item.riskFlags.map((risk) => node("li", { textContent: risk })))] : []),
    node("div", { className: "item-options" }, [
      node("label", { textContent: "冲突处理" }, [conflictSelect]),
      node("label", { textContent: "新名称" }, [rename]),
      ...riskOptions,
    ]),
  ]);
}

function installConfiguration(planElement, plan) {
  const selectedItemIds = [...planElement.querySelectorAll(".install-select:checked")].map((item) => item.dataset.itemId);
  const itemOptions = {};
  for (const item of plan.items || []) {
    const element = planElement.querySelector(`[data-install-item="${CSS.escape(item.id)}"]`);
    if (!element) continue;
    const conflictResolution = element.querySelector(".conflict-resolution")?.value || "keep";
    const acknowledgements = [...element.querySelectorAll("[data-ack]:checked")].map((input) => input.dataset.ack);
    if (conflictResolution === "replace") acknowledgements.push("replace-existing");
    itemOptions[item.id] = {
      conflictResolution,
      renameTo: element.querySelector(".rename-to")?.value || "",
      acknowledgements: unique(acknowledgements),
    };
  }
  return { selectedItemIds, itemOptions };
}

function externalCandidateStatus(value) {
  return ({ suggested: "待审阅", accepted: "已接受", rejected: "已拒绝", installed: "已安装" })[value] || value;
}

async function previewExternalCandidate(candidate) {
  if (busy) return;
  busy = true;
  setStatus(`正在读取并扫描 ${candidate.skillName || candidate.packageId} 的原文…`);
  try {
    const response = await callTool("review_skill_match", {
      kind: "external-preview",
      workflowId: snapshot.workflow.id,
      candidateId: candidate.id,
    });
    const preview = structured(response);
    if (!preview?.document?.sha256) throw new Error("外部 Skill 原文审阅结果不完整");
    externalReviewPreviews.set(candidate.id, preview);
    setStatus("原文已加载；请人工阅读完整内容后再作决定。");
  } catch (error) {
    setStatus(errorMessage(error), "error");
  } finally {
    busy = false;
    renderInstall();
  }
}

function decideExternalCandidate(candidate, decision) {
  const preview = externalReviewPreviews.get(candidate.id);
  if (decision !== "suggested" && !preview?.document?.sha256) {
    setStatus("请先加载并阅读当前外部 Skill 原文。", "warning");
    return;
  }
  mutate("review_skill_match", {
    kind: "external-decision",
    workflowId: snapshot.workflow.id,
    expectedRevision: snapshot.workflow.revision,
    candidateId: candidate.id,
    decision,
    reviewedContentHash: preview?.document?.sha256,
  }, decision === "accepted" ? "外部 Skill 候选已接受，可重新生成安装计划。" : decision === "rejected" ? "外部 Skill 候选已拒绝。" : "外部 Skill 候选已退回待审阅。")
    .then((updated) => { if (updated && decision === "suggested") externalReviewPreviews.delete(candidate.id); });
}

function renderExternalCandidate(candidate) {
  const preview = externalReviewPreviews.get(candidate.id);
  const locked = candidate.status === "installed";
  const actions = [action(preview ? "重新读取原文" : "读取原文并审阅", () => previewExternalCandidate(candidate), {
    disabled: !canMutate() || locked,
  })];
  if (preview) {
    actions.push(
      action("接受候选", () => decideExternalCandidate(candidate, "accepted"), { className: "primary compact", disabled: !canMutate() || locked }),
      action("拒绝候选", () => decideExternalCandidate(candidate, "rejected"), { className: "danger compact", disabled: !canMutate() || locked }),
    );
  }
  if (["accepted", "rejected"].includes(candidate.status) && !locked) {
    actions.push(action("退回待审阅", () => decideExternalCandidate(candidate, "suggested"), { disabled: !canMutate() }));
  }
  const body = [
    node("header", {}, [
      node("div", {}, [node("p", { className: "eyebrow", textContent: "外部候选" }), node("h3", { textContent: candidate.skillName || candidate.packageId })]),
      node("span", { className: "pill", textContent: externalCandidateStatus(candidate.status) }),
    ]),
    node("p", { textContent: candidate.rationale || "由 Agent 针对明确能力缺口记录。" }),
    node("p", { className: "metadata", textContent: `${candidate.packageId || "无可安装包标识"} · ${candidate.publisher || "发布者未知"} · ${candidate.license || "许可证未知"}` }),
    ...(candidate.securityNotes ? [node("p", { className: "metadata", textContent: candidate.securityNotes })] : []),
    node("div", { className: "action-row" }, actions),
  ];
  if (preview) {
    const document = node("textarea", {
      className: "review-document",
      attributes: { rows: "18", readonly: "", "aria-label": `${candidate.skillName || candidate.packageId} 完整原文` },
    });
    document.value = preview.document.content;
    const findings = preview.review?.findings || [];
    body.push(node("div", { className: `notice ${["high", "critical"].includes(preview.review?.severity) ? "error" : "warning"}` }, [
      node("strong", { textContent: `静态线索：${preview.review?.severity || "none"} · ${findings.length} 项` }),
      node("p", { className: "metadata", textContent: `${preview.source.repository}/${preview.source.path} · SHA-256 ${preview.document.sha256}` }),
      ...(findings.length ? [node("ul", { className: "risk-list" }, findings.map((finding) => node("li", { textContent: `${finding.severity} · ${finding.message}（第 ${finding.line} 行）` })))] : []),
      node("p", { textContent: preview.warning }),
    ]), document);
  } else if (candidate.reviewedContentHash) {
    body.push(node("p", { className: "metadata", textContent: `上次人工审阅：${candidate.reviewedSeverity || "none"} · SHA-256 ${candidate.reviewedContentHash}` }));
  }
  return node("article", { className: "external-review" }, body);
}

function renderInstall() {
  const panel = elements.panel_install;
  const workflow = snapshot?.workflow;
  const installation = snapshot?.installation;
  if (!workflow) {
    panel.replaceChildren(panelHeading("受控安装", "选择工作流后创建与其修订绑定的安装计划。"), node("div", { className: "empty", textContent: "尚未选择工作流。" }));
    return;
  }
  const activeJob = installation?.global?.activeJob;
  const actions = [action("生成安装计划", () => mutate("propose_skill_installation_plan", {
    id: workflow.id,
    expectedRevision: workflow.revision,
    targetAgents: selectedTargets,
  }, "安装计划已生成。"), { className: "primary", disabled: !canMutate() || !selectedTargets.length })];
  if (activeJob) actions.push(action("取消当前任务", () => mutate("cancel_skill_installation_job", { jobId: activeJob.id }, "已请求取消安装任务。"), { className: "danger", disabled: !canMutate() }));
  const body = [panelHeading("受控安装", "只有本 App 中的明确人工操作可以接受外部原文或执行写入；每个计划继续受修订、内容哈希、风险、锁与回滚约束。", actions)];
  const externalCandidates = (workflow.externalCandidates || []).slice(-50).reverse();
  if (externalCandidates.length) {
    body.push(node("section", { className: "external-reviews" }, [
      node("header", {}, [node("h3", { textContent: "缺口候选审阅" }), node("p", { textContent: "这里只审阅 Agent 针对明确缺口记录的候选，不提供宽泛 Skill 商店。接受时会重新获取原文并校验哈希。" })]),
      ...externalCandidates.map(renderExternalCandidate),
    ]));
  }
  if (installation?.global?.needsRepair) {
    const repairSelect = node("select", {}, [
      node("option", { textContent: "接受当前状态", attributes: { value: "accept-current" } }),
      node("option", { textContent: "回滚残留", attributes: { value: "rollback" } }),
      node("option", { textContent: "隔离残留", attributes: { value: "quarantine" } }),
    ]);
    body.push(node("div", { className: "notice error" }, [node("strong", { textContent: "检测到中断事务，需要人工处理" }), repairSelect, action("处理修复", () => {
      if (globalThis.confirm && !globalThis.confirm(`确认执行修复操作：${repairSelect.value}？`)) return;
      mutate("resolve_skill_installation_repair", { action: repairSelect.value }, "中断事务已处理。");
    }, { className: "danger", disabled: !canMutate() })]));
  }
  const plans = [...(installation?.plans || [])].reverse();
  for (const plan of plans) {
    const items = node("div", { className: "install-items" }, (plan.items || []).map(renderInstallItem));
    const planElement = node("article", { className: "install-plan" }, [
      node("header", {}, [node("div", {}, [node("p", { className: "eyebrow", textContent: `PLAN ${plan.id.slice(0, 8)}` }), node("h3", { textContent: `${plan.targetAgents?.join(" / ") || "未选目标"} · ${plan.status}` })]), node("span", { className: "pill", textContent: `基于修订 ${plan.basedOnRevision}` })]),
      items,
    ]);
    const warningIds = (plan.items || []).filter((item) => item.status === "installed-warning").map((item) => item.id);
    const controls = node("div", { className: "action-row" }, [
      action("保存选择与风险确认", () => {
        const configured = installConfiguration(planElement, plan);
        mutate("configure_skill_installation_plan", {
          workflowId: workflow.id,
          planId: plan.id,
          expectedRevision: workflow.revision,
          ...configured,
        }, "安装计划配置已保存。", {});
      }, { disabled: !canMutate() || !["draft", "partial", "failed", "cancelled"].includes(plan.status) }),
      action("执行计划", () => {
        executionArmedFor = plan.id;
        renderInstall();
        panel.querySelector(`[data-confirm-plan="${CSS.escape(plan.id)}"]`)?.focus();
      }, { className: "primary", disabled: !canMutate() || plan.basedOnRevision !== workflow.revision || !["draft", "partial", "failed", "cancelled"].includes(plan.status) }),
      ...(warningIds.length ? [action("确认已查看安全警告", () => mutate("acknowledge_skill_installation_warnings", {
        workflowId: workflow.id,
        planId: plan.id,
        expectedRevision: workflow.revision,
        itemIds: warningIds,
      }, "安全警告已确认。"), { disabled: !canMutate() })] : []),
    ]);
    planElement.append(controls);
    if (executionArmedFor === plan.id) {
      planElement.append(node("div", { className: "confirm-box" }, [
        node("strong", { textContent: "确认执行受控写入？" }),
        node("p", { textContent: "将按上次保存的选择执行。含替换或兼容性覆盖的项目必须已完成对应风险确认。" }),
        action("确认并执行", () => {
          executionArmedFor = null;
          mutate("execute_skill_installation_plan", {
            workflowId: workflow.id,
            planId: plan.id,
            expectedRevision: workflow.revision,
          }, "安装任务已排队。", {}).then(scheduleInstallationPolling);
        }, { className: "danger", disabled: !canMutate(), title: "确认执行安装", }),
        action("取消", () => { executionArmedFor = null; renderInstall(); }),
      ]));
      planElement.querySelector(".confirm-box .danger")?.setAttribute("data-confirm-plan", plan.id);
    }
    for (const item of plan.items || []) {
      if (!["installed", "installed-warning"].includes(item.status)) continue;
      planElement.append(action(`隔离 ${item.name}`, () => {
        if (globalThis.confirm && !globalThis.confirm(`确认隔离 ${item.name}？托管目标会被移除。`)) return;
        mutate("quarantine_skill_installation_item", {
          workflowId: workflow.id,
          planId: plan.id,
          itemId: item.id,
          expectedRevision: workflow.revision,
        }, `${item.name} 已移入隔离区。`);
      }, { className: "danger compact", disabled: !canMutate() }));
    }
    body.push(planElement);
  }
  if (!plans.length) body.push(node("div", { className: "empty", textContent: "尚无安装计划。先完成人工 Skill 判断，再生成与当前工作流修订绑定的计划。" }));
  panel.replaceChildren(...body);
  scheduleInstallationPolling();
}

function scheduleInstallationPolling() {
  clearTimeout(pollingTimer);
  pollingTimer = null;
  const active = snapshot?.installation?.global?.activeJob
    || (snapshot?.installation?.plans || []).some((plan) => ["queued", "running"].includes(plan.status));
  if (!active || !connected) return;
  pollingTimer = setTimeout(async () => {
    await refreshSnapshot({ refresh: false, announce: false }).catch((error) => setStatus(errorMessage(error), "error"));
  }, 1_000);
}

function renderSettings() {
  const panel = elements.panel_settings;
  const roots = node("textarea", { attributes: { "aria-label": "自定义 Skill 根目录", placeholder: "/absolute/path/to/skills\n/another/skill/root" } });
  roots.value = (snapshot?.settings?.customRoots || []).join("\n");
  panel.replaceChildren(
    panelHeading("扫描设置", "只保留额外 Skill 根目录配置；保存前会拒绝危险的宽泛路径，并立即重新扫描。"),
    node("article", { className: "settings-card" }, [
      node("label", { textContent: "自定义根目录（每行一项，最多 20 项）" }, [roots]),
      node("div", { className: "action-row" }, [action("保存并重新扫描", async () => {
        const saved = await mutate("update_skill_roots", {
          expectedRevision: snapshot.settings.revision,
          customRoots: unique(roots.value.split(/\r?\n/u)),
        }, "扫描目录已保存。", { refresh: false });
        if (saved) await refreshSnapshot({ refresh: true, announce: false });
      }, { className: "primary", disabled: !canMutate() })]),
      node("p", { className: "metadata", textContent: `设置修订 ${snapshot?.settings?.revision || 0} · 当前扫描 ${snapshot?.inventory?.paths || 0} 个路径 / ${snapshot?.inventory?.uniqueContent || 0} 份唯一内容` }),
    ]),
  );
}

function renderAll() {
  if (!snapshot) return;
  document.documentElement.dataset.host = snapshot.host?.id || "unknown";
  elements.host_badge.textContent = snapshot.host?.recognized ? `当前 ${snapshot.host.label}` : `只读 · ${snapshot.host?.label || "未知宿主"}`;
  elements.context_summary.textContent = snapshot.workflow
    ? `${snapshot.workflow.goal} · ${snapshot.inventory.uniqueContent} 份唯一 Skill · ${new Date(snapshot.generatedAt).toLocaleString()}`
    : `${snapshot.inventory.uniqueContent} 份唯一 Skill；请选择工作流开始测绘。`;
  elements.refresh_app.disabled = !connected || !hostCapabilities().serverTools;
  renderControls();
  renderMap();
  renderPlan();
  renderQuick();
  renderInstall();
  renderSettings();
}

function acceptSnapshot(value) {
  if (!value || value.schemaVersion !== "1" || !value.inventory || !value.workflows) return false;
  snapshot = value;
  const incomingTargets = value.skillPlan?.mappingScope?.targetAgents?.map((target) => target.id) || [];
  if (!selectedTargets.length) selectedTargets = incomingTargets;
  renderAll();
  return true;
}

function openComposer(item) {
  if (!canMessage()) {
    setStatus("当前宿主未提供可用的 ui/message 能力。", "warning");
    return;
  }
  composerReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  selectedSkill = item;
  elements.composer_source.textContent = quickSource(item);
  elements.composer_title.textContent = item.name || "未命名 Skill";
  elements.composer_description.textContent = item.description || item.rationale || "按当前步骤完成任务。";
  elements.task.value = item.taskSuggestion || item.stepTitle || "";
  elements.outputs.value = unique(item.expectedOutputs?.length ? item.expectedOutputs : ["完成结果", "验收说明"]).join("\n");
  elements.form_error.textContent = "";
  elements.composer.hidden = false;
  elements.task.focus();
}

function closeComposer() {
  elements.composer.hidden = true;
  selectedSkill = null;
  const fallback = document.querySelector('[role="tabpanel"]:not([hidden]) button:not(:disabled)');
  const target = composerReturnFocus?.isConnected && !composerReturnFocus.disabled ? composerReturnFocus : fallback;
  composerReturnFocus = null;
  target?.focus();
}

async function sendSelectedSkill(event) {
  event.preventDefault();
  if (!selectedSkill || busy) return;
  const task = elements.task.value.trim();
  const outputs = unique(elements.outputs.value.split(/\r?\n/u));
  if (!task || !outputs.length) {
    elements.form_error.textContent = !task ? "请填写任务。" : "请至少填写一项预期产物。";
    (!task ? elements.task : elements.outputs).focus();
    return;
  }
  const prompt = buildSkillHandoff({
    skill: selectedSkill,
    task,
    targetAgent: `当前 ${snapshot.host.label}`,
    expectedOutputs: outputs,
    context: {
      workflowTitle: snapshot.workflow?.goal || "",
      stageTitle: selectedSkill.stageTitle || snapshot.quickUse?.context?.stageTitle || "",
      stepTitle: selectedSkill.stepTitle || "",
      acceptanceCriteria: selectedSkill.acceptanceCriteria || [],
      invocationPrompt: selectedSkill.invocationPrompt || selectedSkill.invocation || "",
      contentHash: selectedSkill.planContentHash || snapshot.skillPlan?.contentHash || "",
    },
  });
  busy = true;
  elements.send.disabled = true;
  elements.send.textContent = "正在发送…";
  try {
    const handoff = await runUiMessageHandoff({
      sendMessage: async () => {
        const response = await app.sendMessage({ role: "user", content: [{ type: "text", text: prompt }] });
        if (response?.isError) throw new Error("宿主拒绝了 ui/message");
        elements.send_note.textContent = "消息已接受；正在记录最近使用…";
      },
      recordUse: async () => {
        const update = await callTool("update_skillmesh_preferences", {
          expectedRevision: snapshot.quickUse.preferenceRevision,
          operation: { type: "record-use", contentHash: selectedSkill.contentHash },
        });
        if (!structured(update)) throw new Error("最近使用同步失败");
      },
    });
    if (!handoff.synced) {
      elements.form_error.textContent = `消息已发送，但最近使用同步失败；请勿重复发送。${errorMessage(handoff.syncError)}`;
      setStatus("消息已发送；最近使用未能同步。", "warning");
      return;
    }
    await refreshSnapshot({ refresh: false, announce: false });
    setStatus(`已将“${selectedSkill.name}”发送到当前 ${snapshot.host.label}。`);
    closeComposer();
  } catch (error) {
    elements.form_error.textContent = errorMessage(error, "发送失败");
  } finally {
    busy = false;
    elements.send.disabled = false;
    elements.send.textContent = "发送到当前 Agent";
  }
}

async function downloadPlan(format) {
  if (!canDownload() || !snapshot?.skillPlan) {
    setStatus("当前宿主不支持 ui/downloadFile。", "warning");
    return;
  }
  setStatus("正在准备导出…");
  try {
    const response = await callTool("prepare_skill_usage_plan_export", {
      workflowId: snapshot.workflow.id,
      targetAgents: selectedTargets,
      contentHash: snapshot.skillPlan.contentHash,
      format,
    });
    const file = structured(response);
    const resource = {
      uri: `file:///${file.filename}`,
      mimeType: file.mimeType,
      ...(file.text !== undefined ? { text: file.text } : { blob: file.blobBase64 }),
    };
    const downloaded = await app.downloadFile({ contents: [{ type: "resource", resource }] });
    if (downloaded?.isError) throw new Error("宿主取消或拒绝了文件下载");
    setStatus(`${file.filename} 已交给宿主下载。`);
  } catch (error) {
    const message = errorMessage(error);
    setStatus(message, /changed/u.test(message) ? "warning" : "error");
    if (/changed/u.test(message)) await refreshSnapshot({ refresh: false, announce: false }).catch(() => {});
  }
}

function activateTab(name, focus = false) {
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    const active = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    const panel = byId(`panel-${tab.dataset.tab}`);
    panel.hidden = !active;
    if (active && focus) tab.focus();
  }
}

for (const tab of document.querySelectorAll('[role="tab"]')) {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  tab.addEventListener("keydown", (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    let index = tabs.indexOf(tab);
    if (event.key === "Home") index = 0;
    else if (event.key === "End") index = tabs.length - 1;
    else index = (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    activateTab(tabs[index].dataset.tab, true);
  });
}

elements.workflow_select.addEventListener("change", () => selectContext(elements.workflow_select.value, null));
elements.stage_select.addEventListener("change", () => selectContext(elements.workflow_select.value, elements.stage_select.value));
elements.refresh_app.addEventListener("click", () => refreshSnapshot({ refresh: true }).catch((error) => setStatus(errorMessage(error), "error")));
elements.close_composer.addEventListener("click", closeComposer);
elements.use_form.addEventListener("submit", sendSelectedSkill);
elements.expand_app.addEventListener("click", async () => {
  try { await app.requestDisplayMode({ mode: "fullscreen" }); } catch (error) { setStatus(errorMessage(error), "warning"); }
});
document.addEventListener("keydown", (event) => {
  if (elements.composer.hidden) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeComposer();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...elements.composer.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && (document.activeElement === first || !elements.composer.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

app.ontoolresult = (params) => {
  if (!acceptSnapshot(params.structuredContent || structured(params))) setStatus("无法读取 SkillMesh 工作台快照。", "error");
};
app.onhostcontextchanged = () => {
  const context = app.getHostContext() || {};
  document.documentElement.dataset.theme = context.theme || "";
  elements.expand_app.hidden = !context.availableDisplayModes?.includes("fullscreen") || context.displayMode === "fullscreen";
};
app.onteardown = async () => {
  clearTimeout(pollingTimer);
  pollingTimer = null;
  return {};
};

app.connect().then(async () => {
  connected = true;
  const context = app.getHostContext() || {};
  document.documentElement.dataset.theme = context.theme || "";
  elements.expand_app.hidden = !context.availableDisplayModes?.includes("fullscreen") || context.displayMode === "fullscreen";
  if (!snapshot && hostCapabilities().serverTools) await refreshSnapshot({ refresh: true }).catch((error) => setStatus(errorMessage(error), "error"));
  else renderAll();
}).catch((error) => {
  connected = false;
  setStatus(`MCP Apps 连接失败：${errorMessage(error)}`, "error");
});
