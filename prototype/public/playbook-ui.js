const BRIEF_FIELDS = [
  { name: "projectName", label: "项目名称", type: "input", required: true },
  { name: "problemStatement", label: "问题陈述", type: "textarea", required: true, wide: true },
  { name: "targetUsers", label: "目标用户（每行一项）", type: "textarea", required: true },
  { name: "primaryOutcome", label: "首要用户结果", type: "textarea", required: true },
  { name: "inScope", label: "首版范围（每行一项）", type: "textarea", required: true },
  { name: "outOfScope", label: "明确非目标（每行一项）", type: "textarea", required: true },
  { name: "constraints", label: "约束（每行一项）", type: "textarea", required: true },
  { name: "successCriteria", label: "成功标准（每行一项）", type: "textarea", required: true },
  { name: "targetPlatforms", label: "目标平台（每行一项）", type: "textarea", required: true },
  { name: "preferredStack", label: "首选技术栈（每行一项）", type: "textarea", required: true },
  { name: "assumptions", label: "已知假设（每行一项）", type: "textarea" },
  { name: "openQuestions", label: "开放问题（每行一项）", type: "textarea" },
];

const LIST_FIELDS = new Set([
  "targetUsers", "inScope", "outOfScope", "constraints", "successCriteria",
  "targetPlatforms", "preferredStack", "assumptions", "openQuestions",
]);

const VERIFICATION_LABELS = {
  "agent-generated": "Agent 生成",
  "maintainer-reviewed": "维护者已审",
  "sample-run": "样例已跑通",
  "novice-validated": "初级开发者已验证",
};

export function parsePlaybookList(value) {
  return [...new Set(String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
}

function element(tag, { className = "", text, attributes = {}, dataset = {} } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? "" : String(value));
  }
  Object.assign(node.dataset, dataset);
  for (const child of Array.isArray(children) ? children : [children]) if (child) node.append(child);
  return node;
}

function actionButton(label, action, {
  primary = false,
  danger = false,
  disabled = false,
  dataset = {},
  attributes = {},
} = {}) {
  return element("button", {
    className: `button ${primary ? "button-primary" : danger ? "danger-button" : "button-quiet"}`,
    text: label,
    attributes: { type: "button", disabled, ...attributes },
    dataset: { action, ...dataset },
  });
}

function textList(items, { ordered = false, empty = "待补充" } = {}) {
  const list = element(ordered ? "ol" : "ul");
  for (const item of items?.length ? items : [empty]) list.append(element("li", { text: item }));
  return list;
}

function labelValue(label, value) {
  return element("div", {}, [
    element("small", { text: label }),
    element("strong", { text: Array.isArray(value) ? value.join("、") || "未填写" : value || "未填写" }),
  ]);
}

function statusPill(text, variant = "") {
  return element("span", { className: `playbook-pill ${variant}`.trim(), text });
}

function progressRecord(progress, stageId, stepId) {
  return progress?.steps?.find((item) => item.stageId === stageId && item.stepId === stepId) || null;
}

function gateRecord(progress, stageId) {
  return progress?.gates?.find((item) => item.stageId === stageId) || null;
}

function humanError(error) {
  const message = error?.detail?.message || error?.message || "未知错误";
  const labels = {
    "project-brief-not-found": "当前工作流还没有 Project Brief",
    "playbook-not-found": "当前工作流还没有开发手册",
    "project-brief-already-exists": "Project Brief 已存在，请重新载入",
    "frozen-project-brief-required": "请先在网页中冻结 Project Brief",
    "confirmed-playbook-progress-required": "请先人工确认手册版本，再开始记录进度",
    "playbook-progress-not-started": "请先开始当前手册的进度记录",
    "playbook-step-completion-requires-acceptance": "完成步骤前必须将验收结果设为通过",
    "playbook-step-completion-requires-evidence": "硬门步骤完成前必须保存至少一条证据",
    "playbook-gate-rationale-required": "通过或否决质量门时必须填写判断依据",
    "playbook-verification-hash-required": "手册内容已变化，请重新载入后再验证",
    "playbook-sample-run-incomplete": "请先完成全部适用步骤并通过九个质量门",
    "playbook-sample-run-verification-required": "请先保存样例跑通验证",
    "confirmed-playbook-verification-required": "只有已确认的手册才能升级验证等级",
    "human-playbook-verification-required": "验证等级只能由网页中的人工操作升级",
    "playbook-verification-summary-required": "请填写验证结论",
    "playbook-verification-evidence-required": "请至少保存一条可复核证据",
    "playbook-verification-blockers-present": "仍有阻塞项，不能升级验证等级",
    "playbook-verification-sample-required": "请填写样例名称",
    "playbook-verification-environment-required": "请填写样例运行环境",
    "playbook-verification-tester-required": "请填写匿名的初级开发者画像",
    "playbook-verification-assistance-invalid": "只有无需协助或有限协助的结果可标记为初级开发者已验证",
    "playbook-template-migration-required": "当前手册使用旧模板，请先预览并明确迁移",
    "playbook-template-current": "当前手册已经使用最新模板",
    "playbook-template-target-changed": "目标模板在预览后发生变化，请重新预览",
    "playbook-template-preview-hash-required": "迁移预览已过期，请重新预览差异",
    "pdf-renderer-unavailable:run-npm-setup-pdf": "PDF 组件尚未安装，请在 prototype 目录运行 npm run setup:pdf",
  };
  if (labels[message]) return labels[message];
  if (message.startsWith("project-brief-not-freezable:")) return `Project Brief 仍缺少：${message.split(":")[1].split(",").join("、")}`;
  if (message.startsWith("playbook-stage-gate-incomplete:")) return "尚不能进入下一阶段：请完成本阶段全部步骤并通过验收；硬门还必须保存证据";
  if (message.startsWith("playbook-stage-dependency-gate-open:")) return "尚不能开始本阶段：前置阶段还没有通过进入条件";
  if (message.startsWith("playbook-verification-order-required:")) return "验证等级必须按维护者已审 → 样例已跑通 → 初级开发者已验证依次升级";
  if (message.startsWith("pdf-render-failed:") && message.includes("pdf-font-unavailable")) return "未找到可嵌入的中文字体，请设置 CAPABILITY_ATLAS_PDF_FONT";
  return message;
}

function isNotFound(error, code) {
  return error?.status === 404 && error?.detail?.message === code;
}

function formField(definition, brief) {
  const value = LIST_FIELDS.has(definition.name)
    ? (brief?.[definition.name] || []).join("\n")
    : brief?.[definition.name] || "";
  const control = definition.type === "input"
    ? element("input", { attributes: { name: definition.name, value, required: definition.required, maxlength: 4000 } })
    : element("textarea", {
      text: value,
      attributes: { name: definition.name, rows: definition.wide ? 4 : 3, required: definition.required, maxlength: 8000 },
    });
  return element("label", { className: definition.wide ? "wide" : "" }, [
    element("span", { text: `${definition.label}${definition.required ? " *" : ""}` }),
    control,
  ]);
}

function briefPatch(form) {
  const data = new FormData(form);
  const patch = {};
  for (const definition of BRIEF_FIELDS) {
    const value = data.get(definition.name);
    patch[definition.name] = LIST_FIELDS.has(definition.name) ? parsePlaybookList(value) : String(value || "").trim();
  }
  patch.deploymentTarget = String(data.get("deploymentTarget") || "deployable-mvp");
  return patch;
}

function downloadResponse(response, filename) {
  return response.blob().then((blob) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  });
}

export function createPlaybookUi({ api, getWorkflow, toast }) {
  const elements = {
    button: document.querySelector("#playbook-button"),
    dialog: document.querySelector("#playbook-dialog"),
    status: document.querySelector("#playbook-dialog-status"),
    exportButton: document.querySelector("#playbook-export-button"),
    pdfExportButton: document.querySelector("#playbook-pdf-export-button"),
    content: document.querySelector("#playbook-content"),
  };
  const state = {
    workflow: getWorkflow(),
    brief: null,
    playbook: null,
    diff: null,
    progress: null,
    verification: null,
    templateStatus: null,
    templatePreview: null,
    editingBrief: false,
    busy: false,
  };

  function setBusy(value, message = "") {
    state.busy = value;
    elements.content.setAttribute("aria-busy", String(value));
    for (const button of elements.dialog.querySelectorAll("button")) button.disabled = value;
    if (message) elements.status.textContent = message;
  }

  function renderLoading(message = "正在读取 Project Brief 与开发手册……") {
    elements.content.replaceChildren(element("div", { className: "playbook-loading", text: message }));
  }

  function renderError(error) {
    elements.content.replaceChildren(element("div", { className: "playbook-error", text: humanError(error) }));
    elements.status.textContent = "开发手册读取失败";
  }

  async function optionalJson(path, code) {
    try {
      return await (await api(path)).json();
    } catch (error) {
      if (isNotFound(error, code)) return null;
      throw error;
    }
  }

  async function load() {
    state.workflow = getWorkflow();
    if (!state.workflow) {
      state.brief = null;
      state.playbook = null;
      state.diff = null;
      state.progress = null;
      state.verification = null;
      state.templateStatus = null;
      state.templatePreview = null;
      render();
      return;
    }
    renderLoading();
    const workflowId = encodeURIComponent(state.workflow.id);
    try {
      state.brief = await optionalJson(`/api/workflows/${workflowId}/brief`, "project-brief-not-found");
      state.playbook = await optionalJson(`/api/workflows/${workflowId}/playbook`, "playbook-not-found");
      state.diff = state.playbook ? await (await api(`/api/workflows/${workflowId}/playbook/diff`)).json() : null;
      state.progress = state.playbook
        ? await optionalJson(`/api/workflows/${workflowId}/playbook/progress`, "playbook-progress-not-started")
        : null;
      state.verification = state.playbook
        ? await (await api(`/api/workflows/${workflowId}/playbook/verification`)).json()
        : null;
      state.templateStatus = state.playbook
        ? await (await api(`/api/workflows/${workflowId}/playbook/template-status`)).json()
        : null;
      state.templatePreview = null;
      render();
    } catch (error) {
      renderError(error);
      throw error;
    }
  }

  function briefForm(brief) {
    const form = element("form", { className: "brief-form", dataset: { form: "brief" } });
    const grid = element("div", { className: "brief-form-grid" });
    for (const definition of BRIEF_FIELDS) grid.append(formField(definition, brief));
    const deployment = element("select", { attributes: { name: "deploymentTarget" } }, [
      element("option", { text: "本地原型", attributes: { value: "local-prototype" } }),
      element("option", { text: "可部署 MVP", attributes: { value: "deployable-mvp" } }),
      element("option", { text: "生产就绪", attributes: { value: "production-ready" } }),
    ]);
    deployment.value = brief?.deploymentTarget || "deployable-mvp";
    grid.append(element("label", {}, [element("span", { text: "交付目标" }), deployment]));
    form.append(grid);
    const actions = element("div", { className: "playbook-action-row" }, [
      element("button", { className: "button button-quiet", text: "保存草案", attributes: { type: "submit" }, dataset: { submitAction: "save" } }),
      element("button", { className: "button button-primary", text: "保存并冻结", attributes: { type: "submit" }, dataset: { submitAction: "freeze" } }),
    ]);
    form.append(actions);
    return form;
  }

  function renderBrief() {
    const brief = state.brief;
    const section = element("section", { className: "playbook-section" });
    if (!brief) {
      section.append(
        element("div", { className: "playbook-section-heading" }, [
          element("div", {}, [element("h3", { text: "1. 建立 Project Brief" }), element("p", { text: "从当前工作流生成结构化访谈草案，再由你补齐和冻结。" })]),
          statusPill("尚未创建"),
        ]),
        actionButton("创建 Project Brief 草案", "create-brief", { primary: true }),
      );
      return section;
    }
    const completeness = brief.completeness || { completed: 0, required: 10, complete: false };
    section.append(element("div", { className: "playbook-section-heading" }, [
      element("div", {}, [
        element("h3", { text: "1. 冻结 Project Brief" }),
        element("p", { text: brief.status === "frozen" ? `不可变输入 v${brief.frozenVersion}` : `访谈完成度 ${completeness.completed}/${completeness.required}` }),
      ]),
      statusPill(brief.status === "frozen" ? `已冻结 v${brief.frozenVersion}` : `${Math.round((completeness.score || 0) * 100)}%`, brief.status === "frozen" || completeness.complete ? "ready" : ""),
    ]));
    if (brief.status !== "frozen" && completeness.nextQuestion) {
      section.append(element("p", { className: "playbook-question", text: `下一题：${completeness.nextQuestion.prompt}` }));
    }
    if (brief.status !== "frozen" || state.editingBrief) {
      section.append(briefForm(brief));
      if (state.editingBrief) section.append(actionButton("取消编辑", "cancel-edit-brief"));
      return section;
    }
    section.append(element("div", { className: "brief-summary-grid" }, [
      labelValue("项目", brief.projectName),
      labelValue("首要结果", brief.primaryOutcome),
      labelValue("问题", brief.problemStatement),
      labelValue("目标用户", brief.targetUsers),
      labelValue("首版范围", brief.inScope),
      labelValue("非目标", brief.outOfScope),
      labelValue("约束", brief.constraints),
      labelValue("成功标准", brief.successCriteria),
      labelValue("平台", brief.targetPlatforms),
      labelValue("技术栈", brief.preferredStack),
    ]));
    section.append(element("div", { className: "playbook-toolbar" }, [
      element("p", { className: "playbook-muted", text: "修改会创建 Brief 新草案；已有手册仍引用旧的不可变版本，直到明确重新生成。" }),
      actionButton("创建 Brief 新修订", "edit-brief"),
    ]));
    return section;
  }

  function renderSkillDetails(step) {
    const wrapper = element("div");
    wrapper.append(element("h5", { text: "本步骤使用哪些 Skill" }));
    const skills = element("div", { className: "playbook-skill-list" });
    if (!step.skillBindings?.length) skills.append(element("div", { className: "playbook-skill", text: "暂无达到最低证据门槛的本机 Skill；按人工回退路径继续。" }));
    for (const binding of step.skillBindings || []) {
      skills.append(element("div", { className: "playbook-skill" }, [
        element("strong", { text: `${binding.role === "primary" ? "主选" : "备选"} · ${binding.name}${binding.reviewStatus === "confirmed" ? " · 已确认" : " · 待确认"}` }),
        element("p", { text: `${binding.rationale} 就绪度：${binding.readiness}。` }),
        element("p", { text: `使用方式：${binding.usageLevel === "required" ? "本步骤主执行 Skill，持续使用到完成条件全部满足" : "仅在主 Skill 不适用或证据不足时替代"}。` }),
        element("p", { text: `负责范围：${binding.responsibilities?.join("、") || "按匹配能力执行"}。` }),
        element("h6", { text: "做到什么程度才算完成" }),
        textList(binding.completionCriteria?.length ? binding.completionCriteria : step.acceptanceCriteria),
        element("h6", { text: "必须保存的证据" }),
        textList(binding.requiredEvidence?.length ? binding.requiredEvidence : step.evidenceRequirements),
      ]));
    }
    wrapper.append(skills);
    if (step.skillGaps?.length) {
      wrapper.append(element("h5", { text: "能力缺口" }));
      const gaps = element("div", { className: "playbook-gap-list" });
      for (const gap of step.skillGaps) {
        const candidates = gap.externalCandidates?.length
          ? ` 外部候选：${gap.externalCandidates.map((item) => `${item.name}（${item.status}）`).join("、")}。`
          : "";
        gaps.append(element("div", { className: "playbook-gap", text: `${gap.label}：${gap.status === "uncertain" ? "证据不足" : "缺失"}。${candidates}${gap.humanFallback}` }));
      }
      wrapper.append(gaps);
    }
    return wrapper;
  }

  function renderStageSkillMap(stage) {
    const section = element("section", { className: "playbook-step playbook-skill-map" });
    section.append(element("h4", { text: "本阶段 Skill 执行地图" }));
    const list = element("div", { className: "playbook-skill-list" });
    for (const step of stage.steps || []) {
      const primary = step.skillBindings?.find((binding) => binding.role === "primary");
      const alternatives = (step.skillBindings || []).filter((binding) => binding.role === "alternative");
      list.append(element("div", { className: "playbook-skill" }, [
        element("strong", { text: `${step.order}. ${step.title}` }),
        element("p", { text: primary
          ? `${primary.reviewStatus === "confirmed" ? "主 Skill" : "建议主 Skill（待确认）"}：${primary.name}；负责 ${primary.responsibilities?.join("、") || step.requiredCapabilities.join("、")}。`
          : "主 Skill：未找到可信匹配，必须按人工回退执行。" }),
        alternatives.length ? element("p", { text: `备用：${alternatives.map((binding) => binding.name).join("、")}。` }) : null,
        element("p", { text: `完成深度：${step.acceptanceCriteria.join("；")}。` }),
      ]));
    }
    section.append(list);
    return section;
  }

  function renderStepProgress(stage, step, record) {
    if (!state.progress?.current) return null;
    const form = element("form", {
      className: "playbook-progress-form",
      dataset: { form: "step-progress", stageId: stage.id, stepId: step.id },
    });
    const status = element("select", { attributes: { name: "status" } }, [
      element("option", { text: "未开始", attributes: { value: "not-started" } }),
      element("option", { text: "进行中", attributes: { value: "in-progress" } }),
      element("option", { text: "已完成", attributes: { value: "completed" } }),
    ]);
    status.value = record?.status || "not-started";
    const acceptance = element("select", { attributes: { name: "acceptanceResult" } }, [
      element("option", { text: "待验收", attributes: { value: "pending" } }),
      element("option", { text: "验收通过", attributes: { value: "passed" } }),
      element("option", { text: "验收失败", attributes: { value: "failed" } }),
    ]);
    acceptance.value = record?.acceptanceResult || "pending";
    const evidence = record?.evidence?.find((item) => item.kind === "link" || item.kind === "artifact")?.value || "";
    form.append(
      element("label", {}, [element("span", { text: "进度" }), status]),
      element("label", {}, [element("span", { text: "验收" }), acceptance]),
      element("label", {}, [element("span", { text: "证据链接（可选）" }), element("input", { attributes: { name: "evidenceLink", value: evidence, placeholder: "https://… 或本地产物说明" } })]),
      element("label", { className: "wide" }, [element("span", { text: "人工记录；硬门步骤完成时会作为证据保存" }), element("textarea", { text: record?.notes || "", attributes: { name: "notes", rows: 3, maxlength: 4000 } })]),
      element("div", { className: "form-actions" }, [element("button", { className: "button button-primary", text: "保存步骤进度", attributes: { type: "submit", "aria-label": `保存“${step.title}”的步骤进度` } })]),
    );
    return form;
  }

  function renderStep(stage, step) {
    const progress = state.progress?.current;
    const record = progressRecord(progress, stage.id, step.id);
    const article = element("article", { className: "playbook-step" });
    article.append(element("div", { className: "playbook-step-meta" }, [
      element("div", {}, [element("h4", { text: `${step.order}. ${step.title}` }), element("p", { text: step.objective })]),
      statusPill(record?.status === "completed" ? "已完成" : record?.status === "in-progress" ? "进行中" : "未开始", record?.status === "completed" ? "passed" : ""),
    ]));
    article.append(renderSkillDetails(step));
    article.append(element("div", { className: "playbook-step-columns" }, [
      element("div", {}, [element("h5", { text: "必须交付" }), textList(step.expectedOutputs)]),
      element("div", {}, [element("h5", { text: "完成后才可过门" }), textList(step.acceptanceCriteria)]),
    ]));
    const details = element("details", { className: "playbook-step-details" }, [
      element("summary", { text: "查看通用执行参考、调用提示词与失败恢复" }),
      element("h5", { text: "通用执行参考" }),
      textList(step.actions, { ordered: true }),
      element("h5", { text: "可复制提示词" }),
      element("pre", { className: "playbook-prompt", text: step.prompt?.text || "" }),
      actionButton("复制提示词", "copy-prompt", { dataset: { stageId: stage.id, stepId: step.id }, attributes: { "aria-label": `复制“${step.title}”的提示词` } }),
      element("h5", { text: "失败与恢复" }),
      ...((step.failureModes || []).map((item) => element("div", { className: "playbook-gap", text: `${item.symptom} 原因：${item.likelyCause || "待判断"}。恢复：${item.recovery}` }))),
    ]);
    article.append(details);
    const form = renderStepProgress(stage, step, record);
    if (form) article.append(form);
    return article;
  }

  function renderGate(stage) {
    const progress = state.progress?.current;
    const record = gateRecord(progress, stage.id);
    const section = element("section", { className: "playbook-gate" }, [
      element("div", { className: "playbook-step-meta" }, [
        element("div", {}, [element("h4", { text: "进入下一阶段的条件" }), element("p", { text: stage.minimumAssessment })]),
        statusPill(record?.status === "passed" ? "已通过" : record?.status === "failed" ? "未通过" : record?.status === "not-applicable" ? "不适用" : "待判断", record?.status || (stage.qualityGate.level === "hard" ? "hard" : "")),
      ]),
      textList(stage.qualityGate.criteria),
    ]);
    if (stage.qualityGate.requiredEvidence?.length) {
      section.append(element("h5", { text: "过门前必须保存的证据" }), textList(stage.qualityGate.requiredEvidence));
    } else {
      section.append(element("p", { className: "playbook-muted", text: "软门仍需记录未验证假设；只有条件可检查、风险已标注时才能进入下一阶段。" }));
    }
    if (!progress) return section;
    const form = element("form", { className: "playbook-gate-form", dataset: { form: "gate-progress", stageId: stage.id } }, [
      element("label", { className: "wide" }, [element("span", { text: "判断依据（必填）" }), element("textarea", { text: record?.rationale || "", attributes: { name: "rationale", rows: 3, required: true, maxlength: 4000 } })]),
      element("div", { className: "form-actions" }, [
        element("button", { className: "button button-quiet", text: "记录未通过", attributes: { type: "submit", "aria-label": `记录“${stage.title}”质量门未通过` }, dataset: { gateStatus: "failed" } }),
        element("button", { className: "button button-primary", text: stage.applicability === "not-applicable" ? "确认不适用" : "通过质量门", attributes: { type: "submit", "aria-label": stage.applicability === "not-applicable" ? `确认“${stage.title}”阶段不适用` : `通过“${stage.title}”质量门` }, dataset: { gateStatus: stage.applicability === "not-applicable" ? "not-applicable" : "passed" } }),
      ]),
    ]);
    section.append(form);
    return section;
  }

  function renderStage(stage) {
    const gate = gateRecord(state.progress?.current, stage.id);
    const details = element("details", { className: "playbook-stage", attributes: { open: stage.order === 1 } });
    details.append(element("summary", {}, [element("div", { className: "playbook-stage-summary" }, [
      element("div", {}, [element("strong", { text: `${String(stage.order).padStart(2, "0")} · ${stage.title}` }), element("small", { text: `${stage.phase} · ${stage.mode === "loop" ? "Loop Engineering" : "Vibe Coding"}` })]),
      element("div", { className: "playbook-action-row" }, [
        statusPill(stage.applicability === "not-applicable" ? "不适用" : stage.qualityGate.level === "hard" ? "硬门" : "软门", stage.qualityGate.level === "hard" ? "hard" : ""),
        gate?.status === "passed" ? statusPill("已过门", "passed") : null,
      ]),
    ])]));
    const toolbar = element("div", { className: "playbook-step playbook-toolbar" }, [
      element("p", { className: "playbook-muted", text: stage.applicability === "not-applicable" ? `不适用原因：${stage.applicabilityReason}` : stage.summary }),
      actionButton(stage.applicability === "not-applicable" ? "恢复为必需阶段" : "标记阶段不适用", "toggle-stage-na", {
        dataset: { stageId: stage.id },
        attributes: { "aria-label": stage.applicability === "not-applicable" ? `将“${stage.title}”恢复为必需阶段` : `将“${stage.title}”标记为不适用` },
      }),
    ]);
    details.append(toolbar);
    if (stage.applicability !== "not-applicable") details.append(renderStageSkillMap(stage));
    if (stage.applicability !== "not-applicable") for (const step of stage.steps) details.append(renderStep(stage, step));
    details.append(renderGate(stage));
    return details;
  }

  function renderPlaybook() {
    const brief = state.brief;
    const playbook = state.playbook;
    const section = element("section", { className: "playbook-section" });
    if (!brief || brief.status !== "frozen") {
      section.append(element("div", { className: "playbook-section-heading" }, [
        element("div", {}, [element("h3", { text: "2. 生成开发手册" }), element("p", { text: "Project Brief 冻结后才能生成可追溯手册。" })]),
        statusPill("等待 Brief"),
      ]));
      return section;
    }
    if (!playbook) {
      section.append(
        element("div", { className: "playbook-section-heading" }, [
          element("div", {}, [element("h3", { text: "2. 生成开发手册" }), element("p", { text: "将九阶段人工内容模板、当前工作流与本机 Skill 证据编译成项目手册。" })]),
          statusPill(`Brief v${brief.frozenVersion} 已就绪`, "ready"),
        ]),
        actionButton("生成开发手册草案", "generate-playbook", { primary: true }),
      );
      return section;
    }
    section.append(element("div", { className: "playbook-section-heading" }, [
      element("div", {}, [element("h3", { text: playbook.title }), element("p", { text: playbook.summary })]),
      statusPill(playbook.status === "confirmed" ? `已确认 v${playbook.confirmedVersion}` : `草案 r${playbook.revision}`, playbook.status === "confirmed" ? "ready" : ""),
    ]));
    section.append(element("div", { className: "playbook-meta-grid" }, [
      labelValue("验证等级", VERIFICATION_LABELS[playbook.verificationLevel] || playbook.verificationLevel),
      labelValue("交付目标", playbook.deliveryTarget),
      labelValue("内容哈希", playbook.contentHash.slice(0, 16)),
      labelValue("来源", `Brief v${playbook.source.projectBriefVersion} · ${playbook.source.templateId}@${playbook.source.templateVersion}`),
      labelValue("黄金路径技术栈", playbook.goldenStack),
      labelValue("步骤级 Skill 评估", playbook.skillBindingAssessment ? `${playbook.skillBindingAssessment.inventoryUniqueContent} 份唯一内容` : "尚未评估"),
    ]));
    if (state.templateStatus?.migrationRequired) {
      const reasonLabels = {
        "template-id-changed": "模板标识变化",
        "template-version-changed": "模板版本变化",
        "template-fingerprint-missing": "旧手册缺少模板指纹",
        "template-content-changed": "同版本模板内容变化",
      };
      const warning = element("div", { className: "playbook-stale" }, [
        element("strong", { text: `模板迁移待审：${state.templateStatus.currentTemplate.version} → ${state.templateStatus.targetTemplate.version}` }),
        element("p", { text: state.templateStatus.reasons.map((reason) => reasonLabels[reason] || reason).join("、") }),
        element("div", { className: "playbook-action-row" }, [
          actionButton("预览模板迁移", "preview-template-migration", { primary: !state.templatePreview }),
        ]),
      ]);
      if (state.templatePreview) {
        const preview = state.templatePreview;
        warning.append(element("details", { className: "playbook-step-details", attributes: { open: true } }, [
          element("summary", { text: `迁移影响 · ${preview.diff.summary.total} 项差异` }),
          element("p", { text: `新增 ${preview.diff.summary.added} · 修改 ${preview.diff.summary.changed} · 移除 ${preview.diff.summary.removed} · 预览哈希 ${preview.previewContentHash.slice(0, 16)}` }),
          element("p", { text: `${preview.impact.progressWouldBecomeStale ? "当前进度将保留为旧哈希；" : "无当前进度受影响；"}${preview.impact.verificationRecordsWouldBecomeStale ? `${preview.impact.verificationRecordsWouldBecomeStale} 条验证记录将转为旧哈希；` : "无验证记录受影响；"}确认版本 v${preview.impact.confirmedVersionPreserved || 0} 保留。` }),
          element("ul", {}, preview.diff.changes.slice(0, 40).map((change) => element("li", { text: `${change.type === "added" ? "新增" : change.type === "removed" ? "移除" : "修改"}：${change.label}` }))),
          actionButton("应用迁移为新草案", "apply-template-migration", { primary: true }),
        ]));
      }
      section.append(warning);
    }
    if (playbook.status === "draft" && state.diff) {
      const diff = state.diff;
      const diffDetails = element("details", { className: "playbook-step-details", attributes: { open: true } }, [
        element("summary", { text: `版本差异 · ${diff.summary.initialVersion ? "首次生成" : `基于 v${diff.baseVersion}`} · ${diff.summary.total} 项` }),
        element("p", { className: "playbook-muted", text: `新增 ${diff.summary.added} · 修改 ${diff.summary.changed} · 移除 ${diff.summary.removed} · 待确认内容哈希 ${diff.currentContentHash.slice(0, 16)}` }),
        element("ul", {}, (diff.changes || []).slice(0, 40).map((change) => element("li", { text: `${change.type === "added" ? "新增" : change.type === "removed" ? "移除" : "修改"}：${change.label}` }))),
      ]);
      section.append(diffDetails);
    }
    const progress = state.progress;
    const summary = progress?.summary;
    const current = progress?.current;
    const progressBlock = element("div", { className: "playbook-toolbar" });
    if (current) {
      progressBlock.append(element("div", { className: "playbook-progress-summary" }, [
        element("strong", { text: `${summary.completedSteps}/${summary.totalSteps} 步完成` }),
        element("div", { className: "playbook-progress-bar", attributes: { role: "progressbar", "aria-valuemin": 0, "aria-valuemax": summary.totalSteps, "aria-valuenow": summary.completedSteps } }, [element("span", { attributes: { style: `width:${Math.round(summary.completionRatio * 100)}%` } })]),
        statusPill(`${summary.passedGates}/${summary.totalGates} 质量门`),
      ]));
    } else {
      progressBlock.append(element("p", { className: "playbook-muted", text: playbook.status === "confirmed" ? "当前内容哈希尚未开始进度记录。" : "确认不可变手册版本后，才能开始进度记录。" }));
    }
    const actions = element("div", { className: "playbook-action-row" }, [
      ...(playbook.status === "draft" ? [actionButton("人工确认当前手册", "confirm-playbook", { primary: true })] : []),
      ...(playbook.status === "confirmed" && !current ? [actionButton("开始记录进度", "start-progress", { primary: true })] : []),
      ...(!state.templateStatus?.migrationRequired ? [actionButton("明确重新生成", "regenerate-playbook")] : []),
    ]);
    progressBlock.append(actions);
    section.append(progressBlock);
    if (progress?.staleSessions?.length) section.append(element("p", { className: "playbook-stale", text: `检测到 ${progress.staleSessions.length} 个旧内容哈希的进度会话；它们已保留，但不会自动套用到当前手册。` }));
    return section;
  }

  function verificationForm(level) {
    const form = element("form", {
      className: "playbook-progress-form",
      dataset: { form: "playbook-verification", verificationLevel: level },
    });
    if (level === "sample-run") {
      form.append(
        element("label", {}, [element("span", { text: "样例名称" }), element("input", { attributes: { name: "sampleName", required: true, maxlength: 300, placeholder: "例如：任务协作 Web MVP" } })]),
        element("label", { className: "wide" }, [element("span", { text: "运行环境" }), element("textarea", { attributes: { name: "environment", rows: 3, required: true, maxlength: 2000, placeholder: "系统、Node/数据库/浏览器版本和关键配置；不要粘贴密钥" } })]),
      );
    } else {
      const assistance = element("select", { attributes: { name: "assistanceLevel", required: true } }, [
        element("option", { text: "有限协助", attributes: { value: "limited" } }),
        element("option", { text: "无需协助", attributes: { value: "none" } }),
      ]);
      form.append(
        element("label", { className: "wide" }, [element("span", { text: "测试者画像（不要填写姓名）" }), element("textarea", { attributes: { name: "testerProfile", rows: 3, required: true, maxlength: 2000, placeholder: "例如：有基础终端/Git 能力，首次独立完成完整 Web 生命周期" } })]),
        element("label", {}, [element("span", { text: "协助程度" }), assistance]),
      );
    }
    form.append(
      element("label", { className: "wide" }, [element("span", { text: "验证结论" }), element("textarea", { attributes: { name: "summary", rows: 3, required: true, maxlength: 4000, placeholder: "说明完成结果、偏差和为何满足该验证等级" } })]),
      element("label", { className: "wide" }, [element("span", { text: "证据（每行一条，至少一条）" }), element("textarea", { attributes: { name: "evidence", rows: 3, required: true, maxlength: 8000, placeholder: "测试报告链接、部署地址、录屏说明或验收记录" } })]),
      element("label", { className: "wide" }, [element("span", { text: "尚存阻塞（每行一项；有内容时不能升级）" }), element("textarea", { attributes: { name: "blockers", rows: 2, maxlength: 4000 } })]),
      element("div", { className: "form-actions" }, [element("button", {
        className: "button button-primary",
        text: level === "sample-run" ? "记录样例已跑通" : "记录初级开发者已验证",
        attributes: { type: "submit" },
      })]),
    );
    return form;
  }

  function renderVerification() {
    const verification = state.verification;
    const playbook = state.playbook;
    const section = element("section", { className: "playbook-section" });
    const level = verification?.currentLevel || playbook.verificationLevel;
    section.append(element("div", { className: "playbook-section-heading" }, [
      element("div", {}, [
        element("h3", { text: "3. 验证手册有效性" }),
        element("p", { text: "验证记录绑定当前内容哈希；不能通过直接修改字段获得等级。" }),
      ]),
      statusPill(VERIFICATION_LABELS[level] || level, level === "novice-validated" ? "ready" : ""),
    ]));
    if (!verification || playbook.status !== "confirmed") {
      section.append(element("p", { className: "playbook-muted", text: "先审阅差异并确认当前手册，才能积累运行验证证据。" }));
      return section;
    }
    const readiness = verification.sampleRunReadiness;
    section.append(element("div", { className: "playbook-progress-summary" }, [
      element("strong", { text: `${readiness.completedSteps}/${readiness.totalSteps} 步已验收` }),
      statusPill(`${readiness.passedGates}/${readiness.totalGates} 质量门`, readiness.eligible ? "passed" : ""),
      statusPill(`HASH ${verification.playbookContentHash.slice(0, 12)}`),
    ]));
    if (verification.records?.length) {
      const records = element("div", { className: "playbook-skill-list" });
      for (const record of verification.records) {
        const details = [
          element("strong", { text: `${VERIFICATION_LABELS[record.level]} · ${record.sampleName || "匿名测试者"}` }),
        ];
        if (record.testerProfile) details.push(element("p", { className: "playbook-muted", text: `测试者画像：${record.testerProfile}` }));
        details.push(
          element("p", { text: record.summary }),
          element("small", { text: `${record.verifiedAt} · ${record.verifiedBy?.name || "local-user"} · ${record.evidence.map((item) => item.label || item.kind).join("、")}` }),
        );
        records.append(element("div", { className: "playbook-skill" }, details));
      }
      section.append(records);
    }
    if (verification.nextLevel === "sample-run") {
      if (verification.eligible) section.append(verificationForm("sample-run"));
      else section.append(element("p", { className: "playbook-stale", text: `样例验证尚未解锁：还需完成 ${readiness.missingStepIds.length} 个步骤并通过 ${readiness.missingGateIds.length} 个质量门。` }));
    } else if (verification.nextLevel === "novice-validated") {
      section.append(verificationForm("novice-validated"));
    } else if (!verification.nextLevel) {
      section.append(element("p", { className: "playbook-question", text: "当前内容哈希已完成最高等级验证。内容变化后，这些记录会保留为旧版本证据。" }));
    }
    if (verification.staleRecords?.length) {
      section.append(element("p", { className: "playbook-stale", text: `${verification.staleRecords.length} 条验证记录属于旧内容哈希，已保留但不计入当前等级。` }));
    }
    return section;
  }

  function render() {
    elements.exportButton.hidden = !state.playbook;
    elements.pdfExportButton.hidden = !state.playbook;
    if (!state.workflow) {
      elements.status.textContent = "尚未选择工作流";
      elements.content.replaceChildren(element("div", { className: "playbook-empty", text: "请先在左侧选择一份工作流。" }));
      return;
    }
    const nodes = [renderBrief(), renderPlaybook()];
    if (state.playbook) nodes.push(renderVerification());
    if (state.playbook) nodes.push(...state.playbook.stages.map(renderStage));
    elements.content.replaceChildren(...nodes);
    elements.status.textContent = state.playbook
      ? `${state.playbook.stages.length} 个阶段 · ${state.playbook.stages.reduce((total, stage) => total + stage.steps.length, 0)} 个步骤 · ${VERIFICATION_LABELS[state.playbook.verificationLevel] || state.playbook.verificationLevel}`
      : state.brief?.status === "frozen" ? "Project Brief 已冻结，可以生成手册" : "请完成 Project Brief 访谈";
  }

  async function mutate(message, action, success) {
    setBusy(true, message);
    try {
      await action();
      await load();
      if (success) toast(success);
    } catch (error) {
      toast(humanError(error));
      render();
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function createBrief() {
    const id = encodeURIComponent(state.workflow.id);
    await mutate("正在创建 Project Brief 草案……", async () => {
      state.brief = await (await api(`/api/workflows/${id}/brief`, { method: "POST", body: "{}" })).json();
    }, "Project Brief 草案已创建");
  }

  async function saveBrief(form, freeze) {
    const id = encodeURIComponent(state.workflow.id);
    const patch = briefPatch(form);
    await mutate(freeze ? "正在保存并冻结 Project Brief……" : "正在保存 Project Brief……", async () => {
      const updated = await (await api(`/api/workflows/${id}/brief`, {
        method: "PATCH",
        body: JSON.stringify({ expectedRevision: state.brief.revision, patch }),
      })).json();
      state.brief = freeze
        ? await (await api(`/api/workflows/${id}/brief/freeze`, { method: "POST", body: JSON.stringify({ expectedRevision: updated.revision }) })).json()
        : updated;
      state.editingBrief = false;
    }, freeze ? "Project Brief 已冻结" : "Project Brief 草案已保存");
  }

  async function generatePlaybook(regenerate = false) {
    const id = encodeURIComponent(state.workflow.id);
    if (regenerate && !window.confirm("重新生成会创建新的手册草案；旧确认版本和旧内容哈希进度仍会保留。继续吗？")) return;
    await mutate("正在编译九阶段内容并匹配本机 Skill……", async () => {
      state.playbook = await (await api(`/api/workflows/${id}/playbook/generate`, {
        method: "POST",
        body: JSON.stringify({
          briefVersion: state.brief.frozenVersion,
          ...(state.playbook ? { expectedRevision: state.playbook.revision } : {}),
        }),
      })).json();
    }, regenerate ? "手册新草案已生成" : "开发手册草案已生成");
  }

  async function previewTemplateMigration() {
    const id = encodeURIComponent(state.workflow.id);
    setBusy(true, "正在用当前冻结 Brief 和本机 Skill 生成迁移预览……");
    try {
      state.templatePreview = await (await api(`/api/workflows/${id}/playbook/template-preview`)).json();
      render();
      toast("模板迁移预览已生成，尚未保存任何变化");
    } catch (error) {
      toast(humanError(error));
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function applyTemplateMigration() {
    const preview = state.templatePreview;
    if (!preview) throw new Error("请先生成迁移预览");
    const summary = preview.diff.summary;
    const evidenceImpact = preview.impact.progressWouldBecomeStale || preview.impact.verificationRecordsWouldBecomeStale;
    if (!window.confirm(`将模板 ${preview.targetTemplate.version} 应用为新草案：新增 ${summary.added}、修改 ${summary.changed}、移除 ${summary.removed}。${evidenceImpact ? "当前进度或验证证据会保留为旧内容哈希。" : ""}继续吗？`)) return;
    const id = encodeURIComponent(state.workflow.id);
    await mutate("正在应用已审阅的模板迁移……", async () => {
      state.playbook = await (await api(`/api/workflows/${id}/playbook/template-migrate`, {
        method: "POST",
        body: JSON.stringify({
          expectedRevision: state.playbook.revision,
          targetTemplateVersion: preview.targetTemplate.version,
          targetTemplateContentHash: preview.targetTemplate.contentHash,
          previewReviewHash: preview.previewReviewHash,
        }),
      })).json();
    }, "模板迁移已保存为新草案；请审阅版本差异后重新确认");
  }

  async function confirmPlaybook() {
    const summary = state.diff?.summary;
    if (!state.diff || state.diff.currentContentHash !== state.playbook.contentHash) throw new Error("版本差异已过期，请重新载入");
    if (!window.confirm(`已审阅版本差异：新增 ${summary.added}、修改 ${summary.changed}、移除 ${summary.removed}。确认当前内容哈希为不可变的维护者已审版本？`)) return;
    const id = encodeURIComponent(state.workflow.id);
    await mutate("正在确认开发手册……", async () => {
      state.playbook = await (await api(`/api/workflows/${id}/playbook/confirm`, {
        method: "POST",
        body: JSON.stringify({ expectedRevision: state.playbook.revision, reviewedContentHash: state.diff.currentContentHash }),
      })).json();
    }, `已确认开发手册 v${state.playbook.confirmedVersion + 1}`);
  }

  async function startProgress() {
    const id = encodeURIComponent(state.workflow.id);
    await mutate("正在创建内容哈希绑定的进度会话……", async () => {
      await api(`/api/workflows/${id}/playbook/progress/start`, { method: "POST", body: "{}" });
    }, "已开始记录当前手册进度");
  }

  async function toggleStageNa(stageId) {
    const stage = state.playbook.stages.find((item) => item.id === stageId);
    const markNa = stage.applicability !== "not-applicable";
    const reason = markNa ? window.prompt("说明为什么本阶段不适用，以及最低判断是什么：", "") : "";
    if (markNa && !reason?.trim()) return;
    if (!window.confirm("阶段适用性变化会创建新的手册草案并使当前进度变为旧内容哈希。继续吗？")) return;
    const stages = structuredClone(state.playbook.stages);
    const target = stages.find((item) => item.id === stageId);
    target.applicability = markNa ? "not-applicable" : "required";
    target.applicabilityReason = markNa ? reason.trim() : "";
    const id = encodeURIComponent(state.workflow.id);
    await mutate("正在更新阶段适用性……", async () => {
      state.playbook = await (await api(`/api/workflows/${id}/playbook`, {
        method: "PATCH",
        body: JSON.stringify({ expectedRevision: state.playbook.revision, patch: { stages } }),
      })).json();
    }, markNa ? "阶段已标记为不适用，请重新确认手册" : "阶段已恢复为必需，请重新确认手册");
  }

  async function saveStepProgress(form) {
    const id = encodeURIComponent(state.workflow.id);
    const data = new FormData(form);
    const notes = String(data.get("notes") || "").trim();
    const link = String(data.get("evidenceLink") || "").trim();
    const evidence = [
      ...(notes ? [{ kind: "note", label: "人工记录", value: notes }] : []),
      ...(link ? [{ kind: /^https?:\/\//i.test(link) ? "link" : "artifact", label: "产物", value: link }] : []),
    ];
    await mutate("正在保存步骤进度……", async () => {
      await api(`/api/workflows/${id}/playbook/progress/steps`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: state.progress.current.revision,
          stageId: form.dataset.stageId,
          stepId: form.dataset.stepId,
          status: data.get("status"),
          acceptanceResult: data.get("acceptanceResult"),
          notes,
          evidence,
        }),
      });
    }, "步骤进度已保存");
  }

  async function saveGateProgress(form, status) {
    const id = encodeURIComponent(state.workflow.id);
    const data = new FormData(form);
    const rationale = String(data.get("rationale") || "").trim();
    await mutate("正在检查并保存质量门……", async () => {
      await api(`/api/workflows/${id}/playbook/progress/gates`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: state.progress.current.revision,
          stageId: form.dataset.stageId,
          status,
          rationale,
          evidence: rationale ? [{ kind: "note", label: "质量门判断", value: rationale }] : [],
        }),
      });
    }, "质量门判断已保存");
  }

  async function saveVerification(form) {
    const id = encodeURIComponent(state.workflow.id);
    const data = new FormData(form);
    const level = form.dataset.verificationLevel;
    const evidence = parsePlaybookList(data.get("evidence")).map((value) => ({
      kind: /^https?:\/\//i.test(value) ? "link" : "note",
      label: level === "sample-run" ? "样例验证证据" : "初级开发者验证证据",
      value,
    }));
    const body = {
      expectedRevision: state.playbook.revision,
      reviewedContentHash: state.playbook.contentHash,
      level,
      summary: String(data.get("summary") || "").trim(),
      sampleName: String(data.get("sampleName") || "").trim(),
      environment: String(data.get("environment") || "").trim(),
      testerProfile: String(data.get("testerProfile") || "").trim(),
      assistanceLevel: String(data.get("assistanceLevel") || "").trim(),
      blockers: parsePlaybookList(data.get("blockers")),
      evidence,
    };
    await mutate(`正在核对并保存“${VERIFICATION_LABELS[level]}”证据……`, async () => {
      await api(`/api/workflows/${id}/playbook/verification`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    }, `验证等级已升级为“${VERIFICATION_LABELS[level]}”`);
  }

  elements.button.addEventListener("click", async () => {
    state.workflow = getWorkflow();
    if (!state.workflow) {
      toast("请先选择一份工作流");
      return;
    }
    elements.dialog.showModal();
    await load().catch((error) => toast(humanError(error)));
  });

  elements.exportButton.addEventListener("click", async () => {
    if (!state.workflow || !state.playbook) return;
    try {
      const response = await api(`/api/workflows/${encodeURIComponent(state.workflow.id)}/playbook/export?format=markdown`);
      await downloadResponse(response, "development-playbook.md");
      toast("Markdown 开发手册已导出");
    } catch (error) {
      toast(humanError(error));
    }
  });

  elements.pdfExportButton.addEventListener("click", async () => {
    if (!state.workflow || !state.playbook) return;
    try {
      elements.pdfExportButton.disabled = true;
      elements.status.textContent = "正在排版 PDF 开发手册……";
      const response = await api(`/api/workflows/${encodeURIComponent(state.workflow.id)}/playbook/export?format=pdf`);
      await downloadResponse(response, "development-playbook.pdf");
      elements.status.textContent = `${state.playbook.stages.length} 个阶段 · PDF 已生成`;
      toast("PDF 开发手册已导出");
    } catch (error) {
      toast(humanError(error));
    } finally {
      elements.pdfExportButton.disabled = false;
    }
  });

  elements.content.addEventListener("submit", async (event) => {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    try {
      if (form.dataset.form === "brief") await saveBrief(form, event.submitter?.dataset.submitAction === "freeze");
      if (form.dataset.form === "step-progress") await saveStepProgress(form);
      if (form.dataset.form === "gate-progress") await saveGateProgress(form, event.submitter?.dataset.gateStatus || "passed");
      if (form.dataset.form === "playbook-verification") await saveVerification(form);
    } catch (error) {
      console.error(error);
    }
  });

  elements.content.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action]");
    if (!target || state.busy) return;
    try {
      const action = target.dataset.action;
      if (action === "create-brief") await createBrief();
      if (action === "edit-brief") { state.editingBrief = true; render(); }
      if (action === "cancel-edit-brief") { state.editingBrief = false; render(); }
      if (action === "generate-playbook") await generatePlaybook(false);
      if (action === "regenerate-playbook") await generatePlaybook(true);
      if (action === "preview-template-migration") await previewTemplateMigration();
      if (action === "apply-template-migration") await applyTemplateMigration();
      if (action === "confirm-playbook") await confirmPlaybook();
      if (action === "start-progress") await startProgress();
      if (action === "toggle-stage-na") await toggleStageNa(target.dataset.stageId);
      if (action === "copy-prompt") {
        const stage = state.playbook.stages.find((item) => item.id === target.dataset.stageId);
        const step = stage?.steps.find((item) => item.id === target.dataset.stepId);
        if (step) {
          await navigator.clipboard.writeText(step.prompt.text);
          toast("提示词已复制");
        }
      }
    } catch (error) {
      console.error(error);
      toast(humanError(error));
    }
  });

  function setWorkflow(workflow) {
    state.workflow = workflow;
    elements.button.disabled = !workflow;
    if (elements.dialog.open) load().catch((error) => toast(humanError(error)));
  }

  setWorkflow(state.workflow);
  return { setWorkflow, load };
}
