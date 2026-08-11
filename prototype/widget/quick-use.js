import { App } from "@modelcontextprotocol/ext-apps";
import { buildSkillHandoff } from "../public/quick-skill-deck.js";
import { runQuickUseHandoff, validateQuickUseForm } from "./quick-use-actions.js";

const app = new App({ name: "SkillMesh Quick Use", version: "0.7.0" }, {});
const elements = Object.fromEntries([
  "context-summary", "card-count", "workflow-select", "stage-select", "status", "deck", "composer",
  "composer-source", "composer-title", "composer-description", "close-composer", "use-form", "task",
  "outputs", "form-error", "send", "send-note",
].map((id) => [id.replaceAll("-", "_"), document.getElementById(id)]));

let snapshot = null;
let selectedItem = null;
let connected = false;
let sending = false;

function text(value) {
  return String(value || "");
}

function node(tag, { className = "", textContent = "", attributes = {} } = {}, children = []) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (textContent) element.textContent = textContent;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  for (const child of children) if (child) element.append(child);
  return element;
}

function structured(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const block = result?.content?.find?.((item) => item.type === "text");
  if (!block?.text) return null;
  try { return JSON.parse(block.text); } catch { return null; }
}

function setStatus(message = "", tone = "") {
  elements.status.textContent = message;
  elements.status.className = `status${tone ? ` ${tone}` : ""}`;
}

function sourceLabel(item) {
  if (item.source === "current") return item.stepTitle ? `当前步骤 · ${item.stepTitle}` : "当前阶段相关";
  if (item.source === "favorite") return "已收藏";
  return "最近使用";
}

function agentLabel(item) {
  const agents = item.supportedAgents || [];
  if (!agents.length || agents.includes("*")) return "Codex 兼容";
  return agents.slice(0, 2).join(" / ");
}

function section(title, description, sectionData, emptyMessage) {
  const wrapper = node("section", { className: "deck-section" });
  const heading = node("header", { className: "section-heading" });
  const copy = node("div", {}, [node("h2", { textContent: title }), node("p", { textContent: description })]);
  heading.append(copy, node("span", { textContent: sectionData.hidden ? `${sectionData.items.length} / ${sectionData.total}` : String(sectionData.total) }));
  wrapper.append(heading);
  if (!sectionData.items.length) {
    wrapper.append(node("div", { className: "empty", textContent: emptyMessage }));
    return wrapper;
  }
  const grid = node("div", { className: "cards" });
  const favorites = new Set(snapshot.state?.favorites || []);
  for (const item of sectionData.items) {
    const card = node("article", { className: "card" });
    const top = node("div", { className: "card-top" }, [node("span", { className: "card-source", textContent: sourceLabel(item) })]);
    const favorite = favorites.has(item.contentHash);
    const favoriteButton = node("button", {
      className: "favorite",
      textContent: favorite ? "★" : "☆",
      attributes: { type: "button", "aria-pressed": String(favorite), "aria-label": `${favorite ? "取消收藏" : "收藏"} ${text(item.name)}` },
    });
    favoriteButton.addEventListener("click", () => updateState({
      type: "set-favorite",
      contentHash: item.contentHash,
      favorite: !favorite,
    }, favorite ? "已取消收藏" : "已收藏"));
    top.append(favoriteButton);
    card.append(top, node("h3", { textContent: text(item.name) }), node("p", { textContent: text(item.description) || "未提供作用说明" }));
    if (item.source === "current" && item.rationale) card.append(node("p", { className: "rationale", textContent: text(item.rationale) }));
    const useButton = node("button", { className: "primary", textContent: "使用", attributes: { type: "button", "aria-label": `使用 ${text(item.name)}` } });
    useButton.addEventListener("click", () => openComposer(item));
    card.append(node("footer", {}, [node("span", { textContent: agentLabel(item) }), useButton]));
    grid.append(card);
  }
  wrapper.append(grid);
  if (sectionData.hidden) wrapper.append(node("p", { className: "hidden-note", textContent: `另有 ${sectionData.hidden} 项已收起，不展开完整 Skill 卡片墙。` }));
  return wrapper;
}

function renderContextControls() {
  const options = snapshot.workflowOptions || [];
  elements.workflow_select.replaceChildren(node("option", { textContent: options.length > 1 ? "请选择工作流" : "暂无工作流", attributes: { value: "" } }));
  for (const workflow of options) {
    elements.workflow_select.append(node("option", { textContent: text(workflow.title), attributes: { value: workflow.id } }));
  }
  elements.workflow_select.value = snapshot.context?.workflowId || "";
  elements.workflow_select.disabled = !options.length;
  const selectedWorkflow = options.find((workflow) => workflow.id === elements.workflow_select.value);
  elements.stage_select.replaceChildren(node("option", { textContent: selectedWorkflow?.stages?.length ? "请选择阶段" : "暂无阶段", attributes: { value: "" } }));
  for (const stage of selectedWorkflow?.stages || []) {
    elements.stage_select.append(node("option", { textContent: text(stage.title), attributes: { value: stage.id } }));
  }
  elements.stage_select.value = snapshot.context?.stageId || "";
  elements.stage_select.disabled = !selectedWorkflow?.stages?.length;
}

function render() {
  if (!snapshot?.sections) return;
  renderContextControls();
  const context = snapshot.context || {};
  elements.context_summary.textContent = context.selectionRequired
    ? "选择一个工作流后，只显示对应阶段、收藏与最近使用。"
    : context.workflowTitle
      ? `${text(context.workflowTitle)}${context.stageTitle ? ` · ${text(context.stageTitle)}` : ""}`
      : "尚无工作流；仍可使用收藏和最近记录。";
  elements.card_count.textContent = `${snapshot.sections.totalVisible} / 14`;
  elements.deck.replaceChildren(
    section("当前阶段相关", "最多 6 项，优先当前未完成步骤。", snapshot.sections.current, "当前阶段暂无 Codex 兼容 Skill。"),
    section("收藏", "最多 4 项，只显示 Codex 兼容收藏。", snapshot.sections.favorites, "尚无可显示的收藏。"),
    section("最近使用", "最多 4 项，并排除上方重复项。", snapshot.sections.recent, "尚无最近使用记录。"),
  );
  if (snapshot.visibility?.hiddenIncompatibleFavorites) {
    setStatus(`${snapshot.visibility.hiddenIncompatibleFavorites} 个不兼容 Codex 的收藏已保留，但未在此展示。`, "warning");
  }
}

function acceptSnapshot(value) {
  const candidate = value?.sections ? value : value?.deck?.sections ? value.deck : null;
  if (!candidate) return false;
  snapshot = candidate;
  if (selectedItem) {
    const cards = [candidate.sections.current, candidate.sections.favorites, candidate.sections.recent].flatMap((entry) => entry.items || []);
    selectedItem = cards.find((item) => item.contentHash === selectedItem.contentHash) || selectedItem;
  }
  render();
  return true;
}

async function callTool(name, arguments_) {
  if (connected) {
    const result = await app.callServerTool({ name, arguments: arguments_ });
    if (result.isError) throw new Error(result.content?.find?.((item) => item.type === "text")?.text || `${name} 调用失败`);
    return result;
  }
  if (typeof window.openai?.callTool === "function") return window.openai.callTool(name, arguments_);
  throw new Error("当前宿主未提供 MCP Apps 工具桥");
}

async function refreshDeck(context = {}) {
  const result = await callTool("get_quick_skill_deck", context);
  if (!acceptSnapshot(structured(result) || result)) throw new Error("快速卡片返回格式无效");
}

async function updateState(operation, successMessage = "已同步") {
  if (!snapshot) return;
  setStatus("正在同步…");
  try {
    const result = await callTool("update_quick_skill_state", {
      expectedRevision: snapshot.preferenceRevision,
      operation,
    });
    const updated = structured(result) || result;
    const selectingContext = operation.type === "select-context";
    const workflowId = selectingContext
      ? updated.activeWorkflowId || undefined
      : snapshot.context?.workflowId || undefined;
    const stageId = workflowId
      ? selectingContext
        ? updated.activeStageByWorkflow?.[workflowId]
        : snapshot.context?.stageId || undefined
      : undefined;
    await refreshDeck({ workflowId, stageId });
    setStatus(successMessage);
  } catch (error) {
    if (/quick-skill-state-conflict/.test(text(error?.message))) {
      await refreshDeck({ workflowId: snapshot.context?.workflowId || undefined, stageId: snapshot.context?.stageId || undefined }).catch(() => {});
      setStatus("偏好已在另一端更新，已刷新；请重试刚才的操作。", "warning");
      return;
    }
    setStatus(text(error?.message) || "同步失败", "error");
  }
}

function openComposer(item) {
  selectedItem = item;
  elements.composer_source.textContent = sourceLabel(item);
  elements.composer_title.textContent = text(item.name);
  elements.composer_description.textContent = text(item.description) || "未提供作用说明";
  elements.task.value = text(item.taskSuggestion);
  elements.outputs.value = (item.expectedOutputs || []).join("\n");
  elements.form_error.textContent = "";
  elements.deck.hidden = true;
  elements.composer.hidden = false;
  elements.task.focus();
}

function closeComposer() {
  selectedItem = null;
  elements.composer.hidden = true;
  elements.deck.hidden = false;
  elements.deck.querySelector("button.primary")?.focus();
}

function expectedOutputs() {
  return [...new Set(elements.outputs.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
}

async function sendMessage(prompt) {
  if (connected) {
    const result = await app.sendMessage({ role: "user", content: [{ type: "text", text: prompt }] });
    if (result?.isError) throw new Error("宿主拒绝追加消息");
    return;
  }
  if (typeof window.openai?.sendFollowUpMessage === "function") {
    await window.openai.sendFollowUpMessage({ prompt });
    return;
  }
  throw new Error("当前宿主不支持向 Codex 任务追加消息");
}

async function submit(event) {
  event.preventDefault();
  if (sending || !selectedItem) return;
  const validation = validateQuickUseForm({ task: elements.task.value, expectedOutputs: expectedOutputs() });
  if (!validation.valid) {
    elements.form_error.textContent = validation.message;
    (validation.field === "task" ? elements.task : elements.outputs).focus();
    return;
  }
  elements.form_error.textContent = "";
  const prompt = buildSkillHandoff({
    skill: selectedItem,
    task: validation.task,
    targetAgent: "当前 Codex",
    expectedOutputs: validation.expectedOutputs,
    context: {
      workflowTitle: snapshot.context?.workflowTitle || "",
      stageTitle: selectedItem.stageTitle || snapshot.context?.stageTitle || "",
      stepTitle: selectedItem.stepTitle || "",
      acceptanceCriteria: selectedItem.acceptanceCriteria || [],
      invocationPrompt: selectedItem.invocationPrompt || selectedItem.invocation || "",
    },
  });
  sending = true;
  elements.send.disabled = true;
  elements.send.textContent = "正在发送…";
  try {
    const handoff = await runQuickUseHandoff({
      send: () => sendMessage(prompt),
      recordUse: async () => {
        elements.send_note.textContent = "已追加到当前 Codex；正在同步最近使用…";
        await callTool("update_quick_skill_state", {
          expectedRevision: snapshot.preferenceRevision,
          operation: { type: "record-use", contentHash: selectedItem.contentHash },
        });
        await refreshDeck({
          workflowId: snapshot.context?.workflowId || undefined,
          stageId: snapshot.context?.stageId || undefined,
        });
      },
    });
    if (handoff.synced) {
      elements.send_note.textContent = "已发送并记录最近使用。";
      setStatus(`已将“${text(selectedItem.name)}”追加到当前 Codex。`);
    } else {
      elements.send_note.textContent = "消息已发送；最近使用同步失败，请勿重复发送。";
      setStatus(`消息已发送，但偏好同步失败：${text(handoff.syncError?.message)}`, "warning");
    }
  } catch (error) {
    elements.form_error.textContent = text(error?.message) || "发送失败";
  } finally {
    sending = false;
    elements.send.disabled = false;
    elements.send.textContent = "发送到当前 Codex";
  }
}

elements.workflow_select.addEventListener("change", () => {
  updateState({ type: "select-context", workflowId: elements.workflow_select.value || null }, "工作流已切换");
});
elements.stage_select.addEventListener("change", () => {
  updateState({
    type: "select-context",
    workflowId: elements.workflow_select.value,
    stageId: elements.stage_select.value || null,
  }, "阶段已切换");
});
elements.close_composer.addEventListener("click", closeComposer);
elements.use_form.addEventListener("submit", submit);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.composer.hidden) closeComposer();
});

app.ontoolresult = (params) => {
  if (!acceptSnapshot(params.structuredContent || structured(params))) setStatus("无法读取快速卡片结果。", "error");
};
app.onhostcontextchanged = () => {
  document.documentElement.dataset.theme = app.getHostContext()?.theme || "";
};

const compatibilitySnapshot = window.openai?.toolOutput;
if (compatibilitySnapshot) acceptSnapshot(compatibilitySnapshot);
app.connect().then(() => {
  connected = true;
  document.documentElement.dataset.theme = app.getHostContext()?.theme || "";
  if (!snapshot) setStatus("已连接，等待 SkillMesh 返回卡片…");
}).catch((error) => {
  connected = false;
  if (!snapshot) setStatus(`原生桥接不可用：${text(error?.message)}`, "warning");
});
