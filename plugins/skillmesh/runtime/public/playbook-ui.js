const BRIEF_FIELDS = [
  { name: "projectName", label: "项目名称", type: "input", core: true },
  { name: "problemStatement", label: "要解决的问题", type: "textarea", wide: true, core: true },
  { name: "primaryOutcome", label: "希望得到的结果", type: "textarea", core: true },
  { name: "targetUsers", label: "目标用户（每行一项）", type: "textarea" },
  { name: "inScope", label: "首版范围（每行一项）", type: "textarea" },
  { name: "outOfScope", label: "明确非目标（每行一项）", type: "textarea" },
  { name: "constraints", label: "约束（每行一项）", type: "textarea" },
  { name: "successCriteria", label: "成功标准（每行一项）", type: "textarea" },
  { name: "targetPlatforms", label: "目标平台（每行一项）", type: "textarea" },
  { name: "preferredStack", label: "首选技术栈（每行一项）", type: "textarea" },
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

const PLANNING_DEPTH_LABELS = {
  auto: "自动判断",
  quick: "精简 · 最多 3 阶段",
  standard: "标准 · 最多 5 阶段",
  full: "完整 · 保留全部阶段",
};

export function parsePlaybookList(value) {
  return [...new Set(String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
}

export function verificationContextDefaults(brief = {}) {
  const projectName = String(brief.projectName || "当前项目").trim() || "当前项目";
  const targetPlatforms = Array.isArray(brief.targetPlatforms) ? brief.targetPlatforms.filter(Boolean) : [];
  const preferredStack = Array.isArray(brief.preferredStack) ? brief.preferredStack.filter(Boolean) : [];
  const context = [
    targetPlatforms.length ? `目标平台：${targetPlatforms.join("、")}` : "目标平台：按当前执行基线",
    preferredStack.length ? `技术栈：${preferredStack.join("、")}` : "技术栈：按当前执行基线",
    "记录方式：本机人工验证",
  ];
  return {
    sampleName: `${projectName}主路径`,
    environment: context.join("；"),
  };
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
    "playbook-not-found": "当前工作流还没有执行方案",
    "project-brief-already-exists": "Project Brief 已存在，请重新载入",
    "project-brief-required": "当前工作流还没有项目概况",
    "playbook-project-brief-draft-changed": "项目概况已经变化，请重新生成执行方案",
    "playbook-brief-changed-regenerate-required": "项目概况已经变化，请先重新生成执行方案，再锁定执行基线",
    "confirmed-playbook-progress-required": "请先锁定执行基线，再开始记录进度",
    "playbook-progress-not-started": "请先开始当前方案的进度记录",
    "playbook-step-completion-requires-acceptance": "完成步骤前必须将验收结果设为通过",
    "playbook-step-completion-requires-evidence": "硬门步骤完成前必须保存至少一条证据",
    "playbook-gate-rationale-required": "通过或否决质量门时必须填写判断依据",
    "playbook-verification-hash-required": "方案内容已变化，请重新载入后再验证",
    "playbook-sample-run-incomplete": "请先完成全部适用步骤并通过九个质量门",
    "playbook-sample-run-verification-required": "请先保存样例跑通验证",
    "confirmed-playbook-verification-required": "只有已锁定的执行方案才能升级验证等级",
    "human-playbook-verification-required": "验证等级只能由网页中的人工操作升级",
    "playbook-verification-summary-required": "请填写验证结论",
    "playbook-verification-evidence-required": "请至少保存一条可复核证据",
    "playbook-verification-blockers-present": "仍有阻塞项，不能升级验证等级",
    "playbook-verification-sample-required": "请填写样例名称",
    "playbook-verification-environment-required": "请填写样例运行环境",
    "playbook-verification-tester-required": "请填写匿名的初级开发者画像",
    "playbook-verification-assistance-invalid": "只有无需协助或有限协助的结果可标记为初级开发者已验证",
    "playbook-template-migration-required": "当前方案使用旧模板，请先预览并明确迁移",
    "playbook-template-current": "当前方案已经使用最新模板",
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

export function createPlaybookUi({ api, getWorkflow, onWorkflowChange = () => {}, toast }) {
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
    planningDepth: "auto",
    briefSaveTimer: null,
    pendingBriefPatch: null,
    briefSaveInFlight: null,
    busy: false,
  };

  function activeExecutionStage() {
    if (!state.playbook?.stages?.length) return null;
    const progress = state.progress?.current;
    if (!progress) return state.playbook.stages.find((stage) => stage.applicability !== "not-applicable") || null;
    for (const stage of state.playbook.stages) {
      const gate = gateRecord(progress, stage.id);
      if (gate && ["passed", "not-applicable"].includes(gate.status)) continue;
      const dependenciesReady = (stage.dependencies || []).every((dependencyId) => {
        const dependencyGate = gateRecord(progress, dependencyId);
        return dependencyGate && ["passed", "not-applicable"].includes(dependencyGate.status);
      });
      if (dependenciesReady) return stage;
    }
    return null;
  }

  function stageReadyForGate(stage) {
    const progress = state.progress?.current;
    if (!progress) return false;
    return stage.steps.every((step) => {
      const record = progressRecord(progress, stage.id, step.id);
      return record?.status === "completed"
        && record.acceptanceResult === "passed"
        && (stage.qualityGate.level !== "hard" || record.evidence?.length);
    });
  }

  function setBusy(value, message = "") {
    state.busy = value;
    elements.content.setAttribute("aria-busy", String(value));
    for (const button of elements.dialog.querySelectorAll("button")) button.disabled = value;
    if (message) elements.status.textContent = message;
  }

  function renderLoading(message = "正在读取项目概况与执行方案……") {
    elements.content.replaceChildren(element("div", { className: "playbook-loading", text: message }));
  }

  function renderError(error) {
    elements.content.replaceChildren(element("div", { className: "playbook-error", text: humanError(error) }));
    elements.status.textContent = "执行方案读取失败";
  }

  async function optionalJson(path, code) {
    try {
      const separator = path.includes("?") ? "&" : "?";
      return await (await api(`${path}${separator}optional=1`)).json();
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
      if (!state.brief) {
        state.brief = await (await api(`/api/workflows/${workflowId}/brief`, { method: "POST", body: "{}" })).json();
      }
      state.playbook = await optionalJson(`/api/workflows/${workflowId}/playbook`, "playbook-not-found");
      state.planningDepth = state.playbook?.planningDepth || "auto";
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
    const coreGrid = element("div", { className: "brief-form-grid" });
    for (const definition of BRIEF_FIELDS.filter((item) => item.core)) coreGrid.append(formField(definition, brief));
    form.append(
      element("p", { className: "playbook-muted", text: "这些内容已从工作流自动推断。修改会自动保存，不影响你预览执行方案。" }),
      coreGrid,
    );
    const advancedGrid = element("div", { className: "brief-form-grid" });
    for (const definition of BRIEF_FIELDS.filter((item) => !item.core)) advancedGrid.append(formField(definition, brief));
    const deployment = element("select", { attributes: { name: "deploymentTarget" } }, [
      element("option", { text: "本地原型", attributes: { value: "local-prototype" } }),
      element("option", { text: "可部署 MVP", attributes: { value: "deployable-mvp" } }),
      element("option", { text: "生产就绪", attributes: { value: "production-ready" } }),
    ]);
    deployment.value = brief?.deploymentTarget || "deployable-mvp";
    advancedGrid.append(element("label", {}, [element("span", { text: "交付目标" }), deployment]));
    form.append(element("details", { className: "playbook-step-details" }, [
      element("summary", { text: "范围、约束与技术信息（需要时再调整）" }),
      advancedGrid,
    ]));
    const actions = element("div", { className: "playbook-action-row" }, [
      element("small", { className: "playbook-muted", text: "草稿已自动保存", dataset: { briefSaveStatus: "true" } }),
      actionButton("完成编辑", "finish-edit-brief", { primary: true }),
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
          element("div", {}, [element("h3", { text: "1. 项目概况" }), element("p", { text: "系统会从当前工作流自动生成可编辑概况。" })]),
          statusPill("尚未创建"),
        ]),
        actionButton("生成项目概况", "create-brief", { primary: true }),
      );
      return section;
    }
    const completeness = brief.completeness || { completed: 0, required: 10, complete: false };
    section.append(element("div", { className: "playbook-section-heading" }, [
      element("div", {}, [
        element("h3", { text: "1. 项目概况" }),
        element("p", { text: brief.status === "frozen" ? `执行基线 v${brief.frozenVersion}` : "已从工作流自动推断，可直接生成方案" }),
      ]),
      statusPill(brief.status === "frozen" ? `已锁定 v${brief.frozenVersion}` : "自动保存", brief.status === "frozen" || completeness.complete ? "ready" : ""),
    ]));
    if (brief.status !== "frozen" && completeness.nextQuestion) {
      section.append(element("p", { className: "playbook-question", text: `锁定执行基线前仍需补充：${completeness.nextQuestion.prompt}` }));
    }
    if (state.editingBrief) {
      section.append(briefForm(brief));
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
      element("p", { className: "playbook-muted", text: brief.status === "frozen"
        ? "修改会创建新草稿；已锁定基线和历史版本保持不变。"
        : "可直接生成执行方案；只有开始正式执行时才会锁定基线。" }),
      actionButton("编辑项目概况", "edit-brief"),
    ]));
    if (brief.status === "frozen") {
      return element("details", { className: "playbook-baseline-details" }, [
        element("summary", {}, [
          element("div", {}, [
            element("strong", { text: `执行基线 v${brief.frozenVersion} · ${brief.projectName}` }),
            element("span", { text: brief.primaryOutcome }),
          ]),
          statusPill("查看项目概况", "ready"),
        ]),
        section,
      ]);
    }
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

  function renderStepSkillCue(step) {
    const primary = step.skillBindings?.find((binding) => binding.role === "primary");
    const alternatives = (step.skillBindings || []).filter((binding) => binding.role === "alternative");
    const trusted = primary?.reviewStatus === "confirmed";
    const title = primary
      ? `${trusted ? "主 Skill" : "建议 Skill · 待确认"} · ${primary.name}`
      : "本步采用人工回退";
    const description = primary
      ? trusted
        ? `持续使用到本步验收条件全部满足；负责 ${primary.responsibilities?.join("、") || step.requiredCapabilities.join("、")}。`
        : "当前匹配证据不足，不要视为已覆盖；可先按人工路径执行，再按需核对能力缺口。"
      : "当前没有达到可信门槛的本机 Skill；先按交付与验收条件执行，需要时再查看能力缺口。";
    return element("div", { className: `playbook-skill-cue${trusted ? " trusted" : " fallback"}` }, [
      element("div", {}, [element("small", { text: "本步使用" }), element("strong", { text: title })]),
      element("p", { text: description }),
      alternatives.length ? statusPill(`${alternatives.length} 个备用`) : null,
    ]);
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

  function renderFastCompletion(stage, step, record) {
    if (!state.progress?.current || record?.status === "completed") return null;
    const hardGate = stage.qualityGate.level === "hard";
    const remainingSteps = stage.steps.filter((item) =>
      progressRecord(state.progress.current, stage.id, item.id)?.status !== "completed").length;
    const isLastStage = stage.id === state.playbook.stages.filter((item) => item.applicability !== "not-applicable").at(-1)?.id;
    const buttonLabel = remainingSteps > 1
      ? "完成这个步骤"
      : isLastStage ? "完成并进入验证" : "完成并进入下一阶段";
    const form = element("form", {
      className: "playbook-fast-complete",
      dataset: { form: "complete-step", stageId: stage.id, stepId: step.id },
    });
    form.append(
      element("label", { className: "wide" }, [
        element("span", { text: hardGate ? "结果或证据（硬门必填，每行一条）" : "结果或补充说明（可选）" }),
        element("textarea", {
          text: "",
          attributes: {
            name: "completionEvidence",
            rows: 2,
            required: hardGate,
            maxlength: 8000,
            placeholder: hardGate
              ? "测试结果、产物说明或证据链接"
              : "若没有需要补充的内容，可直接完成",
          },
        }),
      ]),
      element("div", { className: "playbook-fast-complete-actions" }, [
        element("small", { text: hardGate
          ? "保存后会同时标记步骤验收通过，并在本阶段完成时自动通过质量门。"
          : "这是可修正的进度记录，不再要求重复填写质量门理由。" }),
        element("button", {
          className: "button button-primary",
          text: buttonLabel,
          attributes: { type: "submit", "aria-label": `${buttonLabel}：“${step.title}”` },
        }),
      ]),
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
    article.append(renderStepSkillCue(step));
    article.append(element("div", { className: "playbook-step-columns" }, [
      element("div", {}, [element("h5", { text: "必须交付" }), textList(step.expectedOutputs)]),
      element("div", {}, [element("h5", { text: "完成后才可过门" }), textList(step.acceptanceCriteria)]),
    ]));
    article.append(element("details", { className: "playbook-step-details" }, [
      element("summary", { text: "查看 Skill 详情与能力缺口" }),
      renderSkillDetails(step),
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
    const fastCompletion = renderFastCompletion(stage, step, record);
    if (fastCompletion) article.append(fastCompletion);
    const form = renderStepProgress(stage, step, record);
    if (form) article.append(element("details", { className: "playbook-step-details playbook-secondary-details" }, [
      element("summary", { text: record?.status === "completed" ? "修改完成记录" : "记录进行中、失败或修正" }),
      form,
    ]));
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
      section.append(element("p", { className: "playbook-muted", text: "软门会在本阶段步骤全部验收后自动通过；仍可在完成记录里补充未验证假设。" }));
    }
    if (!progress) return section;
    if (record?.status === "passed") {
      section.append(element("p", { className: "playbook-gate-complete", text: `已随本阶段最后一个步骤自动通过。${record.rationale ? ` ${record.rationale}` : ""}` }));
      return section;
    }
    const form = element("form", { className: "playbook-gate-form", dataset: { form: "gate-progress", stageId: stage.id } }, [
      element("label", { className: "wide" }, [element("span", { text: "判断依据（必填）" }), element("textarea", { text: record?.rationale || "", attributes: { name: "rationale", rows: 3, required: true, maxlength: 4000 } })]),
      element("div", { className: "form-actions" }, [
        element("button", { className: "button button-quiet", text: "记录未通过", attributes: { type: "submit", "aria-label": `记录“${stage.title}”质量门未通过` }, dataset: { gateStatus: "failed" } }),
        element("button", { className: "button button-primary", text: stage.applicability === "not-applicable" ? "确认不适用" : "通过质量门", attributes: { type: "submit", "aria-label": stage.applicability === "not-applicable" ? `确认“${stage.title}”阶段不适用` : `通过“${stage.title}”质量门` }, dataset: { gateStatus: stage.applicability === "not-applicable" ? "not-applicable" : "passed" } }),
      ]),
    ]);
    if (stageReadyForGate(stage) && stage.applicability !== "not-applicable") {
      section.append(element("div", { className: "playbook-fast-gate" }, [
        element("p", { text: "本阶段步骤已经完成，可直接进入下一阶段。" }),
        actionButton("通过并继续", "advance-stage", { primary: true, dataset: { stageId: stage.id } }),
      ]));
    } else if (stage.applicability !== "not-applicable") {
      section.append(element("p", { className: "playbook-gate-auto", text: "完成并验收本阶段全部步骤后，系统会自动通过这里，无需再次填写和提交。" }));
    }
    section.append(element("details", { className: "playbook-step-details playbook-secondary-details", attributes: { open: stage.applicability === "not-applicable" } }, [
      element("summary", { text: "记录未通过或手动调整质量门" }),
      form,
    ]));
    return section;
  }

  function renderStage(stage) {
    const gate = gateRecord(state.progress?.current, stage.id);
    const activeStage = activeExecutionStage();
    const isActive = activeStage?.id === stage.id;
    const isComplete = gate && ["passed", "not-applicable"].includes(gate.status);
    const details = element("details", { className: `playbook-stage${isActive ? " active" : ""}`, attributes: { open: isActive || (!state.progress?.current && stage.order === 1) } });
    details.append(element("summary", {}, [element("div", { className: "playbook-stage-summary" }, [
      element("div", {}, [element("strong", { text: `${String(stage.order).padStart(2, "0")} · ${stage.title}` }), element("small", { text: `${stage.phase} · ${stage.mode === "loop" ? "Loop Engineering" : "Vibe Coding"}` })]),
      element("div", { className: "playbook-action-row" }, [
        statusPill(stage.applicability === "not-applicable" ? "不适用" : stage.qualityGate.level === "hard" ? "硬门" : "软门", stage.qualityGate.level === "hard" ? "hard" : ""),
        isComplete ? statusPill("已完成", "passed") : isActive ? statusPill("当前阶段", "ready") : statusPill("等待前序"),
      ]),
    ])]));
    const toolbar = element("div", { className: "playbook-step playbook-toolbar" }, [
      element("p", { className: "playbook-muted", text: stage.applicability === "not-applicable" ? `不适用原因：${stage.applicabilityReason}` : stage.summary }),
    ]);
    details.append(toolbar);
    if (stage.applicability !== "not-applicable") for (const step of stage.steps) details.append(renderStep(stage, step));
    details.append(renderGate(stage));
    details.append(element("details", { className: "playbook-stage-settings" }, [
      element("summary", { text: "阶段设置" }),
      actionButton(stage.applicability === "not-applicable" ? "恢复为必需阶段" : "标记阶段不适用", "toggle-stage-na", {
        dataset: { stageId: stage.id },
        attributes: { "aria-label": stage.applicability === "not-applicable" ? `将“${stage.title}”恢复为必需阶段` : `将“${stage.title}”标记为不适用` },
      }),
    ]));
    return details;
  }

  function renderStageArchive(stages, activeStage) {
    const progress = state.progress?.current;
    const completed = stages.filter((stage) => {
      const gate = gateRecord(progress, stage.id);
      return gate && ["passed", "not-applicable"].includes(gate.status);
    }).length;
    const waiting = stages.length - completed;
    const archive = element("details", { className: "playbook-stage-archive" });
    archive.append(element("summary", {}, [
      element("div", {}, [
        element("strong", { text: activeStage ? "其他执行阶段" : "已完成的执行阶段" }),
        element("span", { text: activeStage
          ? `${completed} 个已完成 · ${waiting} 个等待前序`
          : `${completed}/${stages.length} 个阶段已完成，可按需回看记录` }),
      ]),
      statusPill("查看阶段记录"),
    ]));
    for (const stage of stages) archive.append(renderStage(stage));
    return archive;
  }

  function renderExecutionFlow() {
    if (!state.playbook) return [];
    const stages = state.playbook.stages;
    if (!state.progress?.current) return stages.map(renderStage);
    const activeStage = activeExecutionStage();
    const secondaryStages = activeStage
      ? stages.filter((stage) => stage.id !== activeStage.id)
      : stages;
    const nodes = [];
    if (activeStage) nodes.push(renderStage(activeStage));
    if (!activeStage && shouldRenderVerification()) nodes.push(renderVerification());
    if (secondaryStages.length) nodes.push(renderStageArchive(secondaryStages, activeStage));
    if (activeStage && shouldRenderVerification()) nodes.push(renderVerification());
    return nodes;
  }

  function planningDepthControl() {
    const select = element("select", { attributes: { "aria-label": "执行方案深度" }, dataset: { control: "planning-depth" } },
      Object.entries(PLANNING_DEPTH_LABELS).map(([value, label]) => element("option", { text: label, attributes: { value } })));
    select.value = state.planningDepth || "auto";
    return element("label", { className: "playbook-depth-control" }, [element("span", { text: "方案深度" }), select]);
  }

  function renderPlaybook() {
    const brief = state.brief;
    const playbook = state.playbook;
    const section = element("section", { className: "playbook-section" });
    if (!brief) {
      section.append(element("div", { className: "playbook-section-heading" }, [
        element("div", {}, [element("h3", { text: "2. 生成执行方案" }), element("p", { text: "正在准备项目概况。" })]),
        statusPill("准备中"),
      ]));
      return section;
    }
    if (!playbook) {
      section.append(
        element("div", { className: "playbook-section-heading" }, [
          element("div", {}, [element("h3", { text: "2. 生成执行方案" }), element("p", { text: "系统会按任务复杂度压缩流程，并把本机 Skill 放到具体步骤。" })]),
          statusPill(brief.status === "frozen" ? `基线 v${brief.frozenVersion}` : "概况草稿已就绪", "ready"),
        ]),
        element("div", { className: "playbook-action-row" }, [
          planningDepthControl(),
          actionButton("生成执行方案", "generate-playbook", { primary: true }),
        ]),
      );
      return section;
    }
    section.append(element("div", { className: "playbook-section-heading" }, [
      element("div", {}, [element("h3", { text: playbook.title }), element("p", { text: playbook.summary })]),
      statusPill(playbook.status === "confirmed" ? `已确认 v${playbook.confirmedVersion}` : `草案 r${playbook.revision}`, playbook.status === "confirmed" ? "ready" : ""),
    ]));
    const metadata = element("div", { className: "playbook-meta-grid" }, [
      labelValue("验证等级", VERIFICATION_LABELS[playbook.verificationLevel] || playbook.verificationLevel),
      labelValue("方案深度", PLANNING_DEPTH_LABELS[playbook.planningDepth] || playbook.planningDepth),
      labelValue("交付目标", playbook.deliveryTarget),
      labelValue("内容哈希", playbook.contentHash.slice(0, 16)),
      labelValue("来源", `${playbook.source.projectBriefVersion > 0 ? `执行基线 v${playbook.source.projectBriefVersion}` : `项目概况草稿 r${playbook.source.projectBriefRevision}`} · ${playbook.source.templateId}@${playbook.source.templateVersion}`),
      labelValue("黄金路径技术栈", playbook.goldenStack),
      labelValue("步骤级 Skill 评估", playbook.skillBindingAssessment ? `${playbook.skillBindingAssessment.inventoryUniqueContent} 份唯一内容` : "尚未评估"),
    ]);
    if (playbook.status === "draft") section.append(metadata);
    if (state.templateStatus?.migrationRequired) {
      const reasonLabels = {
        "template-id-changed": "模板标识变化",
        "template-version-changed": "模板版本变化",
        "template-fingerprint-missing": "旧方案缺少模板指纹",
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
    const progressBlock = element("div", { className: "playbook-toolbar playbook-execution-toolbar" });
    if (current) {
      const activeStage = activeExecutionStage();
      progressBlock.append(element("div", { className: "playbook-progress-summary" }, [
        element("strong", { text: `${summary.completedSteps}/${summary.totalSteps} 步完成` }),
        element("div", { className: "playbook-progress-bar", attributes: { role: "progressbar", "aria-valuemin": 0, "aria-valuemax": summary.totalSteps, "aria-valuenow": summary.completedSteps } }, [element("span", { attributes: { style: `width:${Math.round(summary.completionRatio * 100)}%` } })]),
        statusPill(`${summary.passedGates}/${summary.totalGates} 质量门`),
      ]));
      const nextVerification = state.verification?.nextLevel;
      const verificationTitle = nextVerification === "sample-run"
        ? "记录样例已跑通"
        : nextVerification === "novice-validated"
          ? "记录初级开发者验证"
          : "验证已完成";
      const nextAction = element(activeStage || !nextVerification ? "div" : "button", {
        className: `playbook-next-action${!activeStage && nextVerification ? " actionable" : ""}`,
        attributes: !activeStage && nextVerification ? { type: "button" } : {},
        dataset: !activeStage && nextVerification ? { action: "focus-verification" } : {},
      }, [
        element("small", { text: activeStage ? "当前只需处理" : nextVerification ? "下一步" : "执行与验证已完成" }),
        element("strong", { text: activeStage ? `${String(activeStage.order).padStart(2, "0")} · ${activeStage.title}` : verificationTitle }),
        element("span", { text: activeStage
          ? "完成本阶段步骤后会自动验收并进入下一阶段。"
          : nextVerification === "sample-run"
            ? "只需补充验证结论与可复核证据。"
            : nextVerification === "novice-validated"
              ? "由一名初级测试者按当前手册完成独立验证。"
              : "当前内容哈希已经完成最高等级验证。" }),
      ]);
      progressBlock.append(nextAction);
    } else {
      progressBlock.append(element("p", { className: "playbook-muted", text: playbook.status === "confirmed" ? "当前执行基线尚未开始进度记录。" : "方案预览可继续调整；正式开始时一次性锁定项目概况、工作流和方案。" }));
    }
    const actions = element("div", { className: "playbook-action-row" }, [
      ...(playbook.status === "draft" ? [actionButton("锁定基线并开始执行", "lock-execution-baseline", { primary: true })] : []),
      ...(playbook.status === "confirmed" && !current ? [actionButton("开始记录进度", "start-progress", { primary: true })] : []),
      ...(playbook.status === "draft" && !state.templateStatus?.migrationRequired ? [planningDepthControl(), actionButton("按该深度重新生成", "regenerate-playbook")] : []),
    ]);
    progressBlock.append(actions);
    section.append(progressBlock);
    if (playbook.status === "confirmed") {
      const settings = element("details", { className: "playbook-baseline-details playbook-plan-settings" }, [
        element("summary", {}, [
          element("div", {}, [element("strong", { text: "版本、来源与方案设置" }), element("span", { text: `基线 v${playbook.confirmedVersion} · ${PLANNING_DEPTH_LABELS[playbook.planningDepth]}` })]),
          statusPill("按需展开"),
        ]),
        metadata,
      ]);
      if (!state.templateStatus?.migrationRequired) settings.append(element("div", { className: "playbook-action-row" }, [
        planningDepthControl(),
        actionButton("按该深度重新生成", "regenerate-playbook"),
      ]));
      section.append(settings);
    }
    if (progress?.staleSessions?.length) section.append(element("p", { className: "playbook-stale", text: `检测到 ${progress.staleSessions.length} 个旧内容哈希的进度会话；它们已保留，但不会自动套用到当前方案。` }));
    return section;
  }

  function verificationForm(level) {
    const defaults = verificationContextDefaults(state.brief);
    const form = element("form", {
      className: "playbook-progress-form playbook-verification-form",
      dataset: { form: "playbook-verification", verificationLevel: level },
    });
    form.append(element("div", { className: "playbook-verification-guidance" }, [
      element("strong", { text: level === "sample-run" ? "记录这次真实运行的结果" : "记录一名初级测试者的独立结果" }),
      element("span", { text: level === "sample-run"
        ? "结论和证据是核心；样例名与项目上下文已经预填。"
        : "测试者画像、结论和证据必须来自实际验证；协助程度可按需调整。" }),
    ]));
    if (level === "sample-run") {
      form.append(
        element("label", {}, [element("span", { text: "验证结论" }), element("textarea", { attributes: { name: "summary", rows: 3, required: true, maxlength: 4000, placeholder: "说明完成结果、偏差和为什么可以继续" } })]),
        element("label", {}, [element("span", { text: "可复核证据（每行一条）" }), element("textarea", { attributes: { name: "evidence", rows: 3, required: true, maxlength: 8000, placeholder: "测试报告、部署地址、录屏说明或验收记录" } })]),
      );
      form.append(element("details", { className: "playbook-verification-context" }, [
        element("summary", { text: "样例与环境已预填；环境不同或有阻塞时调整" }),
        element("div", { className: "playbook-verification-context-grid" }, [
          element("label", {}, [element("span", { text: "样例名称" }), element("input", { attributes: { name: "sampleName", value: defaults.sampleName, required: true, maxlength: 300 } })]),
          element("label", { className: "wide" }, [element("span", { text: "验证上下文" }), element("textarea", { text: defaults.environment, attributes: { name: "environment", rows: 2, required: true, maxlength: 2000 } })]),
          element("label", { className: "wide" }, [element("span", { text: "尚存阻塞（每行一项；有内容时不能升级）" }), element("textarea", { attributes: { name: "blockers", rows: 2, maxlength: 4000 } })]),
        ]),
      ]));
    } else {
      const assistance = element("select", { attributes: { name: "assistanceLevel", required: true } }, [
        element("option", { text: "有限协助", attributes: { value: "limited" } }),
        element("option", { text: "无需协助", attributes: { value: "none" } }),
      ]);
      form.append(
        element("label", {}, [element("span", { text: "测试者画像（不要填写姓名）" }), element("textarea", { attributes: { name: "testerProfile", rows: 3, required: true, maxlength: 2000, placeholder: "例如：有基础终端/Git 能力，首次按当前手册独立执行" } })]),
        element("label", {}, [element("span", { text: "验证结论" }), element("textarea", { attributes: { name: "summary", rows: 3, required: true, maxlength: 4000, placeholder: "说明测试者完成结果、偏差和是否需要协助" } })]),
        element("label", { className: "wide" }, [element("span", { text: "可复核证据（每行一条）" }), element("textarea", { attributes: { name: "evidence", rows: 3, required: true, maxlength: 8000, placeholder: "测试记录、录屏说明或验收记录" } })]),
      );
      form.append(element("details", { className: "playbook-verification-context" }, [
        element("summary", { text: "协助程度与阻塞" }),
        element("div", { className: "playbook-verification-context-grid" }, [
          element("label", {}, [element("span", { text: "协助程度" }), assistance]),
          element("label", { className: "wide" }, [element("span", { text: "尚存阻塞（每行一项；有内容时不能升级）" }), element("textarea", { attributes: { name: "blockers", rows: 2, maxlength: 4000 } })]),
        ]),
      ]));
    }
    form.append(
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
    const section = element("section", {
      className: "playbook-section playbook-verification-section",
      attributes: { tabindex: -1 },
      dataset: { verificationSection: "true" },
    });
    const level = verification?.currentLevel || playbook.verificationLevel;
    section.append(element("div", { className: "playbook-section-heading" }, [
      element("div", {}, [
        element("h3", { text: "3. 验证下一步" }),
        element("p", { text: "只记录能被证据支持的结果；结论和证据是必填，其他上下文按需修正。" }),
      ]),
      statusPill(VERIFICATION_LABELS[level] || level, level === "novice-validated" ? "ready" : ""),
    ]));
    if (!verification || playbook.status !== "confirmed") {
      section.append(element("p", { className: "playbook-muted", text: "先锁定当前执行基线，才能积累运行验证证据。" }));
      return section;
    }
    const readiness = verification.sampleRunReadiness;
    section.append(element("div", { className: "playbook-progress-summary" }, [
      element("strong", { text: `${readiness.completedSteps}/${readiness.totalSteps} 步已验收` }),
      statusPill(`${readiness.passedGates}/${readiness.totalGates} 质量门`, readiness.eligible ? "passed" : ""),
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
      section.append(element("details", { className: "playbook-verification-records" }, [
        element("summary", { text: `已保存验证记录 · ${verification.records.length}` }),
        records,
      ]));
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
    section.append(element("details", { className: "playbook-verification-technical" }, [
      element("summary", { text: "查看版本绑定" }),
      element("p", { className: "playbook-muted", text: `当前内容哈希 ${verification.playbookContentHash}。验证记录会绑定当前方案和进度修订；内容变化后保留为旧版本证据。` }),
    ]));
    return section;
  }

  function shouldRenderVerification() {
    const verification = state.verification;
    if (!verification || state.playbook?.status !== "confirmed") return false;
    return Boolean(
      verification.sampleRunReadiness?.eligible
      || verification.records?.length
      || verification.nextLevel === "novice-validated"
      || !verification.nextLevel
    );
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
    if (state.playbook) nodes.push(...renderExecutionFlow());
    elements.content.replaceChildren(...nodes);
    elements.status.textContent = state.playbook
      ? `${state.playbook.stages.length} 个阶段 · ${state.playbook.stages.reduce((total, stage) => total + stage.steps.length, 0)} 个步骤 · ${VERIFICATION_LABELS[state.playbook.verificationLevel] || state.playbook.verificationLevel}`
      : "项目概况已就绪，可以直接生成执行方案";
  }

  function focusVerification() {
    const section = elements.content.querySelector("[data-verification-section]");
    if (!section) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    section.scrollIntoView({ behavior, block: "start" });
    const target = section.querySelector('form[data-form="playbook-verification"] textarea');
    requestAnimationFrame(() => (target || section).focus({ preventScroll: true }));
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

  function updateBriefSaveStatus(message) {
    const status = elements.content.querySelector("[data-brief-save-status]");
    if (status) status.textContent = message;
  }

  function queueBriefAutosave(form) {
    state.pendingBriefPatch = briefPatch(form);
    clearTimeout(state.briefSaveTimer);
    updateBriefSaveStatus("等待自动保存……");
    state.briefSaveTimer = setTimeout(() => {
      flushBriefAutosave().catch((error) => {
        console.error(error);
        toast(humanError(error));
      });
    }, 650);
  }

  async function flushBriefAutosave() {
    clearTimeout(state.briefSaveTimer);
    state.briefSaveTimer = null;
    if (state.briefSaveInFlight) await state.briefSaveInFlight;
    if (!state.pendingBriefPatch || !state.brief) return state.brief;
    const id = encodeURIComponent(state.workflow.id);
    const patch = state.pendingBriefPatch;
    state.pendingBriefPatch = null;
    updateBriefSaveStatus("正在自动保存……");
    state.briefSaveInFlight = (async () => {
      state.brief = await (await api(`/api/workflows/${id}/brief`, {
        method: "PATCH",
        body: JSON.stringify({ expectedRevision: state.brief.revision, patch }),
      })).json();
      updateBriefSaveStatus("草稿已自动保存");
      return state.brief;
    })();
    try {
      await state.briefSaveInFlight;
    } finally {
      state.briefSaveInFlight = null;
    }
    if (state.pendingBriefPatch) return flushBriefAutosave();
    return state.brief;
  }

  async function finishBriefEdit() {
    await flushBriefAutosave();
    state.editingBrief = false;
    render();
  }

  async function generatePlaybook(regenerate = false) {
    const id = encodeURIComponent(state.workflow.id);
    await flushBriefAutosave();
    const requestedDepth = state.planningDepth || "auto";
    await mutate("正在按任务复杂度生成执行方案并匹配本机 Skill……", async () => {
      state.playbook = await (await api(`/api/workflows/${id}/playbook/generate`, {
        method: "POST",
        body: JSON.stringify({
          depth: requestedDepth,
          ...(state.playbook ? { expectedRevision: state.playbook.revision } : {}),
        }),
      })).json();
      state.planningDepth = state.playbook.planningDepth;
    }, regenerate ? "执行方案已按新深度重新生成" : "执行方案草案已生成");
  }

  async function previewTemplateMigration() {
    const id = encodeURIComponent(state.workflow.id);
    setBusy(true, "正在用当前项目概况和本机 Skill 生成迁移预览……");
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

  async function lockExecutionBaseline() {
    await flushBriefAutosave();
    if (!state.diff || state.diff.currentContentHash !== state.playbook.contentHash) throw new Error("版本差异已过期，请重新载入");
    if (!window.confirm(`将当前项目概况、工作流和执行方案统一锁定为执行基线，并开始记录进度。当前方案包含 ${state.playbook.stages.length} 个阶段；历史基线仍会保留。继续吗？`)) return;
    const id = encodeURIComponent(state.workflow.id);
    await mutate("正在锁定执行基线并开始进度记录……", async () => {
      const result = await (await api(`/api/workflows/${id}/playbook/lock`, {
        method: "POST",
        body: JSON.stringify({
          expectedWorkflowRevision: state.workflow.revision,
          expectedBriefRevision: state.brief.revision,
          expectedPlaybookRevision: state.playbook.revision,
          reviewedContentHash: state.diff.currentContentHash,
        }),
      })).json();
      state.workflow = result.workflow;
      state.brief = result.projectBrief;
      state.playbook = result.playbook;
      onWorkflowChange(result.workflow);
    }, "执行基线已锁定，进度记录已开始");
  }

  async function startProgress() {
    const id = encodeURIComponent(state.workflow.id);
    await mutate("正在创建内容哈希绑定的进度会话……", async () => {
      await api(`/api/workflows/${id}/playbook/progress/start`, { method: "POST", body: "{}" });
    }, "已开始记录当前方案进度");
  }

  async function toggleStageNa(stageId) {
    const stage = state.playbook.stages.find((item) => item.id === stageId);
    const markNa = stage.applicability !== "not-applicable";
    const reason = markNa ? window.prompt("说明为什么本阶段不适用，以及最低判断是什么：", "") : "";
    if (markNa && !reason?.trim()) return;
    if (!window.confirm("阶段适用性变化会创建新的方案草案并使当前进度变为旧内容哈希。继续吗？")) return;
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
    }, markNa ? "阶段已标记为不适用，请重新锁定方案" : "阶段已恢复为必需，请重新锁定方案");
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

  async function completeStepAndAdvance(form) {
    const id = encodeURIComponent(state.workflow.id);
    const stage = state.playbook.stages.find((item) => item.id === form.dataset.stageId);
    const step = stage?.steps.find((item) => item.id === form.dataset.stepId);
    if (!stage || !step) throw new Error("playbook-progress-step-required");
    const entries = parsePlaybookList(new FormData(form).get("completionEvidence"));
    if (stage.qualityGate.level === "hard" && !entries.length) {
      throw new Error("playbook-step-completion-requires-evidence");
    }
    const evidence = entries.map((value) => ({
      kind: /^https?:\/\//i.test(value) ? "link" : "note",
      label: "完成证据",
      value,
    }));
    const notes = entries.filter((value) => !/^https?:\/\//i.test(value)).join("\n");
    const remainingSteps = stage.steps.filter((item) =>
      item.id !== step.id
      && progressRecord(state.progress.current, stage.id, item.id)?.status !== "completed").length;
    const success = remainingSteps
      ? "步骤已完成并验收通过"
      : "阶段已完成，质量门已自动通过";
    await mutate("正在完成步骤并检查阶段门……", async () => {
      await api(`/api/workflows/${id}/playbook/progress/complete`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: state.progress.current.revision,
          stageId: stage.id,
          stepId: step.id,
          notes,
          evidence,
        }),
      });
    }, success);
  }

  async function advanceStage(stageId) {
    const id = encodeURIComponent(state.workflow.id);
    await mutate("正在通过阶段门并进入下一阶段……", async () => {
      await api(`/api/workflows/${id}/playbook/progress/gates`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: state.progress.current.revision,
          stageId,
          status: "passed",
          rationale: "本阶段全部步骤已完成并验收通过。",
          evidence: [],
        }),
      });
    }, "质量门已通过，下一阶段已展开");
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
    focusVerification();
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
      toast("Markdown 执行方案已导出");
    } catch (error) {
      toast(humanError(error));
    }
  });

  elements.pdfExportButton.addEventListener("click", async () => {
    if (!state.workflow || !state.playbook) return;
    try {
      elements.pdfExportButton.disabled = true;
      elements.status.textContent = "正在排版 PDF 执行方案……";
      const response = await api(`/api/workflows/${encodeURIComponent(state.workflow.id)}/playbook/export?format=pdf`);
      await downloadResponse(response, "development-playbook.pdf");
      elements.status.textContent = `${state.playbook.stages.length} 个阶段 · PDF 已生成`;
      toast("PDF 执行方案已导出");
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
      if (form.dataset.form === "complete-step") await completeStepAndAdvance(form);
      if (form.dataset.form === "step-progress") await saveStepProgress(form);
      if (form.dataset.form === "gate-progress") await saveGateProgress(form, event.submitter?.dataset.gateStatus || "passed");
      if (form.dataset.form === "playbook-verification") await saveVerification(form);
    } catch (error) {
      console.error(error);
    }
  });

  elements.content.addEventListener("input", (event) => {
    const form = event.target.closest('form[data-form="brief"]');
    if (form) queueBriefAutosave(form);
  });

  elements.content.addEventListener("change", (event) => {
    const depth = event.target.closest('[data-control="planning-depth"]');
    if (depth) state.planningDepth = depth.value;
    const form = event.target.closest('form[data-form="brief"]');
    if (form) queueBriefAutosave(form);
  });

  elements.content.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action]");
    if (!target || state.busy) return;
    try {
      const action = target.dataset.action;
      if (action === "create-brief") await createBrief();
      if (action === "edit-brief") { state.editingBrief = true; render(); }
      if (action === "finish-edit-brief") await finishBriefEdit();
      if (action === "generate-playbook") await generatePlaybook(false);
      if (action === "regenerate-playbook") await generatePlaybook(true);
      if (action === "preview-template-migration") await previewTemplateMigration();
      if (action === "apply-template-migration") await applyTemplateMigration();
      if (action === "lock-execution-baseline") await lockExecutionBaseline();
      if (action === "start-progress") await startProgress();
      if (action === "focus-verification") focusVerification();
      if (action === "advance-stage") await advanceStage(target.dataset.stageId);
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
    if (state.workflow?.id !== workflow?.id) {
      clearTimeout(state.briefSaveTimer);
      state.briefSaveTimer = null;
      state.pendingBriefPatch = null;
      state.editingBrief = false;
    }
    state.workflow = workflow;
    elements.button.disabled = !workflow;
    if (elements.dialog.open) load().catch((error) => toast(humanError(error)));
  }

  setWorkflow(state.workflow);
  return { setWorkflow, load };
}
