function inline(value) {
  return String(value || "").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
}

function checklist(items, fallback = "待确认") {
  const values = Array.isArray(items) && items.length ? items : [fallback];
  return values.map((item) => `- ${inline(item)}`).join("\n");
}

function origin(binding) {
  const agents = (binding.supportedAgents || []).filter((agent) => agent && agent !== "*");
  return agents.length ? agents.join(" / ") : (binding.providers || []).join(" / ");
}

function renderBinding(binding, label) {
  const source = origin(binding);
  return [
    `**${label}：${inline(binding.name)}**（${binding.reviewStatus === "confirmed" ? "已确认" : "待确认"}；${inline(binding.readiness)}）`,
    ...(source ? [`- 发现于：${inline(source)}`] : []),
    `- 负责：${inline(binding.responsibilities?.join("、") || "按当前步骤能力执行")}`,
    `- 依据：${inline(binding.rationale)}`,
    `- 调用方式：${inline(binding.invocationPrompt)}`,
  ].join("\n");
}

function renderCard(card) {
  const supporting = card.supportingSkills?.length
    ? ["", "#### 已确认协作 Skill", "", ...card.supportingSkills.map((binding) => renderBinding(binding, "协作 Skill"))]
    : [];
  const alternatives = card.alternatives?.length
    ? ["", "#### 待确认备选", "", ...card.alternatives.map((binding) => renderBinding(binding, "备选 Skill"))]
    : [];
  const partial = card.coverageGaps?.length
    ? ["", `> 当前步骤仍有能力缺口：${card.coverageGaps.map((gap) => gap.label).join("、")}。`]
    : [];
  return [
    `### ${String(card.order).padStart(2, "0")} · ${inline(card.stepTitle)}`,
    "",
    inline(card.objective),
    "",
    renderBinding(card.primary, "主 Skill"),
    ...supporting,
    ...alternatives,
    "",
    "#### 使用到什么程度",
    "",
    checklist(card.completionCriteria),
    ...partial,
  ].join("\n");
}

function availabilityLabel(status) {
  return ({
    ready: "目标端已就绪",
    "other-agent": "其他 Agent 可同步",
    pending: "证据待确认",
    ecosystem: "生态补充安装",
  })[status] || status;
}

function renderAvailability(items) {
  return ["ready", "other-agent", "pending", "ecosystem"].flatMap((status) => {
    const matches = (items || []).filter((item) => item.status === status);
    const lines = matches.length
      ? matches.map((item) => {
        const candidates = item.candidates?.length
          ? `；${item.candidates.map((candidate) => {
            const source = origin(candidate);
            return `${candidate.name}${source ? `（${source}）` : ""}`;
          }).join("、")}`
          : "";
        return `- **${inline(item.label)}** · ${inline(item.stageTitle)}${inline(candidates)}`;
      })
      : ["- 无"];
    return [`### ${availabilityLabel(status)} · ${matches.length}`, "", ...lines, ""];
  });
}

function renderGaps(gaps) {
  if (!gaps?.length) return "当前目标没有能力缺口。";
  return gaps.map((gap) => {
    const candidates = gap.candidates?.length
      ? `；候选：${gap.candidates.map((item) => `${item.name}（${item.status}）`).join("、")}`
      : "";
    return `- **${inline(gap.label)}** · ${inline(gap.stepTitle)}（${availabilityLabel(gap.availability || gap.status)}）${inline(candidates)}`;
  }).join("\n");
}

function renderTargetPlan(targetPlan) {
  const stages = (targetPlan.stages || []).flatMap((stage) => {
    if (!stage.cards?.length) return [];
    return [
      `### ${String(stage.order).padStart(2, "0")} · ${inline(stage.title)}`,
      "",
      ...stage.cards.map(renderCard),
      "",
    ];
  });
  return [
    `## ${inline(targetPlan.targetAgent?.label || targetPlan.targetAgent?.id)} 测绘结果`,
    "",
    `- 应用目录：${targetPlan.targetAgent?.detected ? "已检测" : "未检测"}`,
    `- 必需能力：${targetPlan.summaryCounts?.requiredCapabilityCount || 0}`,
    `- 目标端已就绪：${targetPlan.summaryCounts?.readyCapabilityCount || 0}`,
    `- 其他 Agent 可同步：${targetPlan.summaryCounts?.otherAgentCount || 0}`,
    `- 证据待确认：${targetPlan.summaryCounts?.pendingCount || 0}`,
    `- 生态补充安装：${targetPlan.summaryCounts?.ecosystemGapCount || 0}`,
    "",
    "### Agent 能力归属",
    "",
    ...renderAvailability(targetPlan.capabilityAvailability),
    "### 能力缺口",
    "",
    renderGaps(targetPlan.gaps),
    "",
    "### Skill 路线",
    "",
    ...(stages.length ? stages : ["当前没有达到可信门槛的主 Skill。", ""]),
  ];
}

export function renderSkillPlanMarkdown(plan) {
  const depth = { quick: "精简", standard: "标准", full: "完整" }[plan.planningDepth] || plan.planningDepth;
  const targetPlans = plan.targetPlans?.length
    ? plan.targetPlans
    : [{
      targetAgent: plan.mappingScope?.targetAgents?.[0] || { id: "current", label: "当前 Agent", detected: true },
      stages: plan.stages || [],
      gaps: plan.gaps || [],
      capabilityAvailability: [],
      summaryCounts: plan.summaryCounts || {},
    }];
  return [
    `# ${inline(plan.title)}`,
    "",
    inline(plan.summary),
    "",
    `- 测绘目标：${(plan.mappingScope?.targetAgents || []).map((target) => target.label).join(" / ") || "当前 Agent"}`,
    `- 目标来源：${inline(plan.mappingScope?.source || "current-host")}`,
    `- 自动深度：${depth}`,
    `- 可信 Skill：${plan.summaryCounts?.trustedSkillCount || 0}`,
    `- 目标端已就绪能力：${plan.summaryCounts?.readyCapabilityCount || 0}`,
    `- 其他 Agent 可同步：${plan.summaryCounts?.otherAgentCount || 0}`,
    `- 证据待确认：${plan.summaryCounts?.pendingCount || 0}`,
    `- 生态补充安装：${plan.summaryCounts?.ecosystemGapCount || 0}`,
    `- 工作流修订：${plan.source?.workflowRevision || 0}`,
    `- 生成时间：${inline(plan.generatedAt)}`,
    `- 内容哈希：${inline(plan.contentHash)}`,
    "",
    ...targetPlans.flatMap(renderTargetPlan),
    "> Skill 推荐来自本机扫描、文本证据与人工映射，不代表已经运行验证；“其他 Agent 可同步”也不代表已写入目标 Agent。",
    "",
  ].join("\n");
}
