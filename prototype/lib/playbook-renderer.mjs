import { publicPlaybook } from "./playbook-model.mjs";

function inline(value) {
  return String(value || "").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
}

function listText(value, fallback = "未指定") {
  return Array.isArray(value) && value.length ? value.join("、") : fallback;
}

function lines(items, prefix = "- ") {
  return (items || []).map((item) => `${prefix}${inline(item)}`).join("\n");
}

function checklist(items) {
  return lines(items, "- [ ] ") || "- [ ] 待补充";
}

function numbered(items) {
  return (items || []).map((item, index) => `${index + 1}. ${inline(item)}`).join("\n") || "1. 待补充";
}

function fenced(value, language = "text") {
  const source = String(value || "").trim();
  const longest = Math.max(0, ...[...source.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${source}\n${fence}`;
}

function verificationLabel(value) {
  return {
    "agent-generated": "Agent 生成",
    "maintainer-reviewed": "维护者已审",
    "sample-run": "样例已跑通",
    "novice-validated": "初级开发者已验证",
  }[value] || value;
}

function modeLabel(value) {
  return value === "loop" ? "Loop Engineering" : "Vibe Coding";
}

function renderSkillBindings(bindings) {
  if (!bindings?.length) return "- 待进行步骤级 Skill 匹配；当前步骤仍可按人工回退路径完成。";
  return bindings.map((binding) => [
    `- **${binding.role === "primary" ? "主 Skill" : "备选 Skill"}：${inline(binding.name)}**（${binding.reviewStatus === "confirmed" ? "已确认" : "待确认"}；${inline(binding.readiness)}）`,
    binding.rationale ? `  - 依据：${inline(binding.rationale)}` : "",
    `  - 使用方式：${binding.usageLevel === "required" ? "作为本步骤主执行 Skill，持续使用到全部完成条件满足" : "仅在主 Skill 不适用或证据不足时替代"}`,
    binding.responsibilities?.length ? `  - 负责范围：${inline(binding.responsibilities.join("、"))}` : "",
    binding.completionCriteria?.length ? `  - 完成深度：${inline(binding.completionCriteria.join("；"))}` : "",
    binding.requiredEvidence?.length ? `  - 完成证据：${inline(binding.requiredEvidence.join("；"))}` : "",
    binding.invocationPrompt ? `  - 调用提示：${inline(binding.invocationPrompt)}` : "",
    binding.humanFallback ? `  - 人工回退：${inline(binding.humanFallback)}` : "",
  ].filter(Boolean).join("\n")).join("\n");
}

function renderSkillGaps(gaps) {
  if (!gaps?.length) return "";
  return [
    "",
    "**能力缺口**",
    "",
    ...gaps.map((gap) => {
      const candidates = gap.externalCandidates?.length
        ? `；外部候选：${gap.externalCandidates.map((item) => `${item.name}（${item.status}）`).join("、")}`
        : "";
      return `- ${inline(gap.label)}（${gap.status === "uncertain" ? "证据不足" : "缺失"}）${candidates}\n  - 人工回退：${inline(gap.humanFallback)}`;
    }),
  ].join("\n");
}

function renderFailureModes(items) {
  const rows = (items || []).map((item) =>
    `| ${inline(item.symptom)} | ${inline(item.likelyCause || "待判断")} | ${inline(item.recovery)} |`);
  return [
    "| 现象 | 常见原因 | 恢复动作 |",
    "| --- | --- | --- |",
    ...(rows.length ? rows : ["| 待补充 | 待判断 | 返回本步骤重新核对前提与验收标准。 |"]),
  ].join("\n");
}

function renderStep(step) {
  const commands = step.commands?.length
    ? `\n\n#### 人工执行命令\n\n> Capability Atlas 不会执行以下命令。复制前请检查项目环境和影响范围。\n\n${fenced(step.commands.join("\n"), "sh")}`
    : "";
  return [
    `### ${step.order}. ${inline(step.title)}`,
    "",
    `**目标：** ${inline(step.objective)}`,
    "",
    "#### Skill 执行要求",
    "",
    renderSkillBindings(step.skillBindings),
    renderSkillGaps(step.skillGaps),
    "",
    "#### 做到什么程度才算完成",
    "",
    checklist(step.acceptanceCriteria),
    "",
    "#### 必须保存的证据",
    "",
    checklist(step.evidenceRequirements),
    "",
    "#### 开始前",
    "",
    checklist(step.prerequisites),
    "",
    "#### 操作",
    "",
    numbered(step.actions),
    "",
    "#### 可复制提示词",
    "",
    fenced(step.prompt?.text, "text"),
    commands,
    "",
    "#### 预期产出",
    "",
    checklist(step.expectedOutputs),
    "",
    "#### 失败与恢复",
    "",
    renderFailureModes(step.failureModes),
    "",
    `> 执行策略：${step.execution?.mode === "manual" ? "仅人工执行" : inline(step.execution?.mode)}；自动执行：禁止；批准策略：${inline(step.execution?.approvalPolicy)}。`,
  ].join("\n");
}

function renderStage(stage) {
  const applicability = stage.applicability === "not-applicable"
    ? `不适用（${inline(stage.applicabilityReason)}）`
    : "必需";
  return [
    `## 阶段 ${stage.order}：${inline(stage.title)}`,
    "",
    `- 阶段：${inline(stage.phase)}`,
    `- 模式：${modeLabel(stage.mode)}`,
    `- 适用性：${applicability}`,
    `- 质量门：${stage.qualityGate.level === "hard" ? "硬门" : "软门"}`,
    "",
    stage.summary ? `${inline(stage.summary)}\n` : "",
    `> 最低判断：${inline(stage.minimumAssessment)}`,
    "",
    "### 本阶段 Skill 执行地图",
    "",
    ...stage.steps.map((step) => {
      const primary = step.skillBindings?.find((binding) => binding.role === "primary");
      const alternatives = (step.skillBindings || []).filter((binding) => binding.role === "alternative");
      const primaryLabel = primary
        ? `${primary.reviewStatus === "confirmed" ? "主 Skill" : "建议主 Skill（待确认）"} ${inline(primary.name)}`
        : "未匹配，走人工回退";
      return `- **${step.order}. ${inline(step.title)}**：${primaryLabel}${alternatives.length ? `；备用 ${inline(alternatives.map((binding) => binding.name).join("、"))}` : ""}；完成深度：${inline(step.acceptanceCriteria.join("；"))}`;
    }),
    "",
    "### 进入下一阶段的条件",
    "",
    checklist(stage.qualityGate.criteria),
    "",
    stage.qualityGate.requiredEvidence?.length
      ? `**过门前必须保存的证据**\n\n${checklist(stage.qualityGate.requiredEvidence)}\n`
      : "**软门记录**：允许带着已明确标注的假设进入下一阶段，但条件必须可检查、风险必须已记录。\n",
    ...(stage.applicability === "not-applicable" ? [] : stage.steps.map((step) => `\n${renderStep(step)}\n`)),
  ].filter((item) => item !== "").join("\n");
}

export function renderPlaybookMarkdown({ playbook, projectBrief, verification = null }) {
  const publicView = publicPlaybook(playbook);
  const metadata = [
    ["Playbook ID", publicView.id],
    ["版本状态", publicView.status === "confirmed" ? `已确认 v${publicView.confirmedVersion}` : `草案 r${publicView.revision}`],
    ["验证等级", verificationLabel(publicView.verificationLevel)],
    ["内容哈希", publicView.contentHash],
    ["工作流来源", `${publicView.source.workflowReferenceId}@${publicView.source.workflowReferenceVersion}`],
    ["Project Brief", `${publicView.source.projectBriefId}@${publicView.source.projectBriefVersion}`],
    ["模板", `${publicView.source.templateId}@${publicView.source.templateVersion}`],
    ["交付目标", publicView.deliveryTarget],
  ];
  return [
    `# ${inline(publicView.title)}`,
    "",
    publicView.summary,
    "",
    "| 元数据 | 值 |",
    "| --- | --- |",
    ...metadata.map(([key, value]) => `| ${inline(key)} | ${inline(value)} |`),
    "",
    "## 使用方式",
    "",
    "1. 每个步骤先看“Skill 执行要求”：主 Skill 必须持续使用到完成条件满足；备用 Skill 只在主 Skill 不适配时替代。",
    "2. Skill 输出必须对应步骤的交付物、完成深度与证据，不能只运行一次或给出泛化建议。",
    "3. 只有“进入下一阶段的条件”全部满足，且所需证据已保存，才能通过阶段门。",
    "4. Capability Atlas 不会自动运行 Skill、命令或修改项目；执行与过门均需人工确认。",
    "5. 阶段不能删除；确实不适用时，必须保留最低判断并填写原因。",
    "",
    "## 冻结的 Project Brief",
    "",
    `- 项目：${inline(projectBrief.projectName)}`,
    `- 问题：${inline(projectBrief.problemStatement)}`,
    `- 目标用户：${inline(listText(projectBrief.targetUsers))}`,
    `- 首要结果：${inline(projectBrief.primaryOutcome)}`,
    `- 首版范围：${inline(listText(projectBrief.inScope))}`,
    `- 非目标：${inline(listText(projectBrief.outOfScope))}`,
    `- 约束：${inline(listText(projectBrief.constraints, "无额外约束"))}`,
    `- 成功标准：${inline(listText(projectBrief.successCriteria))}`,
    `- 目标平台：${inline(listText(projectBrief.targetPlatforms))}`,
    `- 黄金路径技术栈：${inline(publicView.goldenStack.join("、"))}`,
    "",
    ...publicView.stages.map(renderStage),
    "",
    "## 当前内容验证记录",
    "",
    `- 当前等级：${verificationLabel(verification?.currentLevel || publicView.verificationLevel)}`,
    `- 内容哈希：${inline(verification?.playbookContentHash || publicView.contentHash)}`,
    ...(verification?.records?.length ? verification.records.flatMap((record) => [
      "",
      `### ${verificationLabel(record.level)}`,
      "",
      `- 验证对象：${inline(record.sampleName || record.testerProfile)}`,
      record.environment ? `- 环境：${inline(record.environment)}` : "",
      record.assistanceLevel ? `- 协助程度：${inline(record.assistanceLevel)}` : "",
      `- 结论：${inline(record.summary)}`,
      `- 验证时间：${inline(record.verifiedAt)}`,
      `- 证据：${inline(record.evidence.map((item) => `${item.label || item.kind}：${item.value}`).join("；"))}`,
    ].filter(Boolean)) : ["", "尚无样例跑通或初级开发者验证记录。"]),
    "",
    "## 验证等级说明",
    "",
    "- Agent 生成：结构与字段通过系统校验，但内容尚未人工确认。",
    "- 维护者已审：维护者已检查草案与变更差异。",
    "- 样例已跑通：至少一个标准样例按手册完成。",
    "- 初级开发者已验证：目标用户可在有限协助下完成项目。",
    "",
  ].join("\n");
}
