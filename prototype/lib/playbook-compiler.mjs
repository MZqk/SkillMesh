import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { projectBriefContentHash } from "./project-brief-model.mjs";

const TEMPLATE_PATH = path.resolve(import.meta.dirname, "../data/web-product-playbook.json");
const DEFAULT_WEB_STACK = [
  "Next.js App Router",
  "TypeScript",
  "PostgreSQL",
  "Playwright",
];

let cachedTemplate = null;

function stageMode(index) {
  return index < 4 ? "vibe" : "loop";
}

function gateLevel(index) {
  return index < 4 ? "soft" : "hard";
}

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function listText(value, fallback = "未指定") {
  return Array.isArray(value) && value.length ? value.join("、") : fallback;
}

function templateContext(projectBrief, goldenStack) {
  return {
    projectName: projectBrief.projectName,
    problemStatement: projectBrief.problemStatement,
    targetUsers: listText(projectBrief.targetUsers),
    primaryOutcome: projectBrief.primaryOutcome,
    inScope: listText(projectBrief.inScope),
    outOfScope: listText(projectBrief.outOfScope),
    constraints: listText(projectBrief.constraints, "无额外约束"),
    successCriteria: listText(projectBrief.successCriteria),
    targetPlatforms: listText(projectBrief.targetPlatforms),
    goldenStack: goldenStack.join("、"),
  };
}

function materialize(value, context) {
  if (typeof value === "string") {
    return value.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (_match, key) => String(context[key] || "未指定"));
  }
  if (Array.isArray(value)) return value.map((item) => materialize(item, context));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materialize(item, context)]));
  }
  return value;
}

function fallbackPrompt({ brief, stage, mode }) {
  const questions = (stage.questions || []).map((question) => `- ${question}`).join("\n") || "- 识别本阶段仍未回答的关键问题。";
  const outputs = (stage.deliverables || []).map((item) => `- ${item}`).join("\n") || "- 一份可供下一阶段直接使用的产出。";
  return [
    `你正在协助初级开发者完成“${brief.projectName}”项目。`,
    `项目问题：${brief.problemStatement}`,
    `首要用户结果：${brief.primaryOutcome}`,
    `当前阶段：${stage.phase} / ${stage.title}`,
    `工作模式：${mode === "vibe" ? "Vibe Coding（快速探索并显式记录假设）" : "Loop Engineering（实现、验证、反馈、修正闭环）"}`,
    "请先检查 Project Brief 与前置产出，再完成本阶段任务。不要自动执行命令或修改项目；给出可由人确认后操作的步骤。",
    "需要回答：",
    questions,
    "必须产出：",
    outputs,
    `验收门：${stage.acceptanceGate || "产出能够被下一阶段直接使用，并明确未解决风险。"}`,
  ].join("\n");
}

function fallbackStage({ stage, index, stageTitleById, projectBrief }) {
  const mode = stageMode(index);
  const expectedOutputs = stage.deliverables?.length ? stage.deliverables : [`${stage.title}阶段产出`];
  const acceptanceCriteria = [stage.acceptanceGate || "产出能够被下一阶段直接使用，并明确未解决风险。"];
  return {
    id: stage.id,
    phase: stage.phase,
    title: stage.title,
    summary: stage.summary || stage.description,
    mode,
    applicability: "required",
    applicabilityReason: "",
    minimumAssessment: `即使本阶段不适用，也必须说明原因，并判断“${stage.acceptanceGate || "是否会阻断下一阶段"}”。`,
    dependencies: stage.dependencies || [],
    steps: [{
      id: `${stage.id}-complete`,
      title: `完成${stage.title}`,
      objective: stage.description || stage.summary || `形成${stage.title}阶段可验收产出。`,
      requiredCapabilities: (stage.capabilities || []).map((capability) => capability.id),
      prerequisites: (stage.dependencies || []).map((dependency) => `已完成：${stageTitleById.get(dependency) || dependency}`),
      actions: [
        "核对 Project Brief、本阶段目标和前置产出，列出仍待确认的假设。",
        `按${mode === "vibe" ? "快速探索与人工取舍" : "实现—验证—反馈—修正闭环"}完成本阶段工作。`,
        "保存产出与判断依据，并逐条检查验收标准。",
      ],
      prompt: { text: fallbackPrompt({ brief: projectBrief, stage, mode }), copyable: true },
      commands: [],
      expectedOutputs,
      acceptanceCriteria,
      failureModes: [{
        symptom: "产出无法被下一阶段直接使用，或关键结论只有口头判断。",
        likelyCause: "范围、证据、依赖或验收标准仍不明确。",
        recovery: "回到 Project Brief 和本阶段问题，补齐缺失信息；记录变更理由后重新逐条检查验收门。",
      }],
      evidenceRequirements: gateLevel(index) === "hard"
        ? [...expectedOutputs, "验收结果与失败恢复记录"]
        : ["关键假设、取舍与待验证问题记录"],
      skillBindings: [],
      execution: {
        mode: "manual",
        executor: null,
        autoExecutionAllowed: false,
        approvalPolicy: gateLevel(index) === "hard" ? "human-at-gate" : "human-before-action",
        evidenceFields: ["notes", "artifactLinks", "acceptanceResult"],
      },
    }],
    qualityGate: {
      level: gateLevel(index),
      criteria: acceptanceCriteria,
      requiredEvidence: gateLevel(index) === "hard" ? expectedOutputs : [],
    },
  };
}

const DEPTH_STAGE_LIMITS = {
  quick: 3,
  standard: 5,
  full: 9,
};

const DEPTH_STAGE_LABELS = {
  quick: [
    ["定义", "澄清目标与边界"],
    ["交付", "完成最小可行结果"],
    ["验证", "验证结果并收尾"],
  ],
  standard: [
    ["探索", "明确方向与证据"],
    ["定义", "确定范围与方案"],
    ["实现", "交付端到端主路径"],
    ["验收", "验证质量与风险"],
    ["发布", "发布、观测与改进"],
  ],
};

export function resolvePlanningDepth({ workflow, projectBrief, requestedDepth = "auto" }) {
  if (["quick", "standard", "full"].includes(requestedDepth)) return requestedDepth;
  const riskLevel = workflow?.requirement?.riskLevel || "medium";
  if (projectBrief?.deploymentTarget === "production-ready" || ["high", "critical"].includes(riskLevel)) return "full";
  if (projectBrief?.deploymentTarget === "local-prototype" || riskLevel === "low" || (workflow?.stages || []).length <= 3) return "quick";
  return "standard";
}

function partitionStages(stages, targetCount) {
  if (stages.length <= targetCount) return stages.map((stage) => [stage]);
  if (stages.length === 9 && targetCount === 5) {
    return [[...stages.slice(0, 2)], [...stages.slice(2, 4)], [...stages.slice(4, 6)], [stages[6]], [...stages.slice(7, 9)]];
  }
  const groups = [];
  let offset = 0;
  for (let index = 0; index < targetCount; index += 1) {
    const remaining = stages.length - offset;
    const remainingGroups = targetCount - index;
    const size = Math.ceil(remaining / remainingGroups);
    groups.push(stages.slice(offset, offset + size));
    offset += size;
  }
  return groups.filter((group) => group.length);
}

function condensedStage({ group, groupIndex, depth, projectBrief }) {
  const labels = DEPTH_STAGE_LABELS[depth] || [];
  const [phase, title] = labels[groupIndex] || [group[0].phase, group.map((stage) => stage.title).join(" / ")];
  const id = `${depth}-${groupIndex + 1}`;
  const requiredCapabilities = unique(group.flatMap((stage) => (stage.capabilities || []).map((capability) => capability.id)));
  const expectedOutputs = unique(group.flatMap((stage) => stage.deliverables || []));
  const acceptanceCriteria = unique(group.map((stage) => stage.acceptanceGate).filter(Boolean));
  const questions = unique(group.flatMap((stage) => stage.questions || []));
  const sourceTitles = group.map((stage) => stage.title);
  const hardGate = group.some((stage) => Number(stage.order || 0) >= 5);
  const stepTitle = depth === "quick" ? title : `完成${title}`;
  const promptStage = {
    phase,
    title,
    questions,
    deliverables: expectedOutputs,
    acceptanceGate: acceptanceCriteria.join("；"),
  };
  return {
    id,
    phase,
    title,
    summary: `合并原流程的“${sourceTitles.join("、")}”，只保留本次交付必须完成的判断与产出。`,
    mode: hardGate ? "loop" : "vibe",
    applicability: "required",
    applicabilityReason: "",
    minimumAssessment: `至少完成“${sourceTitles.join("、")}”的关键判断，并说明未覆盖项是否会阻断交付。`,
    dependencies: groupIndex ? [`${depth}-${groupIndex}`] : [],
    steps: [{
      id: `${id}-complete`,
      title: stepTitle,
      objective: `用一个可验收步骤完成：${sourceTitles.join("、")}。`,
      requiredCapabilities,
      prerequisites: groupIndex ? [`上一阶段“${(labels[groupIndex - 1] || ["", "前置阶段"])[1]}”已经完成。`] : [],
      actions: [
        ...group.map((stage) => `完成“${stage.title}”：${stage.description || stage.summary || stage.acceptanceGate || "形成可供下一步使用的结论与产出。"}`),
        "保存关键产出、未决风险和验收结果；不展开本次目标不需要的治理动作。",
      ],
      prompt: { text: fallbackPrompt({ brief: projectBrief, stage: promptStage, mode: hardGate ? "loop" : "vibe" }), copyable: true },
      commands: [],
      expectedOutputs: expectedOutputs.length ? expectedOutputs : [`${title}产出`],
      acceptanceCriteria: acceptanceCriteria.length ? acceptanceCriteria : ["结果可以被下一阶段直接使用，并且剩余风险已明确。"],
      failureModes: [{
        symptom: "合并后的步骤范围仍然过大，或关键结果无法验收。",
        likelyCause: "目标、依赖或完成标准仍不明确。",
        recovery: "只保留阻断主路径的问题，把其他事项记为后续项，再按验收标准重新执行本步骤。",
      }],
      evidenceRequirements: hardGate ? unique([...expectedOutputs, "验收结果与剩余风险记录"]) : ["关键假设与取舍记录"],
      skillBindings: [],
      execution: {
        mode: "manual",
        executor: null,
        autoExecutionAllowed: false,
        approvalPolicy: hardGate ? "human-at-gate" : "human-before-action",
        evidenceFields: ["notes", "artifactLinks", "acceptanceResult"],
      },
    }],
    qualityGate: {
      level: hardGate ? "hard" : "soft",
      criteria: acceptanceCriteria.length ? acceptanceCriteria : ["结果可以被下一阶段直接使用，并且剩余风险已明确。"],
      requiredEvidence: hardGate ? expectedOutputs : [],
    },
  };
}

function projectBriefSnapshot(projectBrief) {
  const { completeness: _completeness, contentHash: _contentHash, history: _history, ...snapshot } = projectBrief;
  return structuredClone(snapshot);
}

export async function loadPlaybookTemplate() {
  if (!cachedTemplate) cachedTemplate = JSON.parse(await fs.readFile(TEMPLATE_PATH, "utf8"));
  return structuredClone(cachedTemplate);
}

export function playbookTemplateContentHash(template) {
  return crypto.createHash("sha256").update(JSON.stringify(template)).digest("hex");
}

export async function compilePlaybookDraft({ workflow, projectBrief, depth = "full" }) {
  if (!workflow?.id) throw new Error("playbook-workflow-required");
  if (!projectBrief?.id) throw new Error("project-brief-required");
  const template = await loadPlaybookTemplate();
  const planningDepth = resolvePlanningDepth({ workflow, projectBrief, requestedDepth: depth });
  const title = `${projectBrief.projectName}：从 0 到 1 执行方案`;
  const stageTitleById = new Map((workflow.stages || []).map((stage) => [stage.id, stage.title]));
  const goldenStack = projectBrief.preferredStack?.length ? projectBrief.preferredStack : DEFAULT_WEB_STACK;
  const context = templateContext(projectBrief, goldenStack);
  const templateStages = new Map(template.stages.map((stage) => [stage.id, stage]));
  const fullStages = (workflow.stages || []).map((stage, index) => {
    const source = templateStages.get(stage.id);
    if (!source) return fallbackStage({ stage, index, stageTitleById, projectBrief });
    const content = materialize(source, context);
    const dependencyPrerequisites = (stage.dependencies || [])
      .map((dependency) => `已完成：${stageTitleById.get(dependency) || dependency}`);
    const steps = content.steps.map((step, stepIndex) => ({
      ...step,
      prerequisites: unique(stepIndex === 0
        ? [...dependencyPrerequisites, ...(step.prerequisites || [])]
        : step.prerequisites || []),
      prompt: { text: step.prompt, copyable: true },
      expectedOutputs: unique(stepIndex === content.steps.length - 1
        ? [...(step.expectedOutputs || []), ...(stage.deliverables || [])]
        : step.expectedOutputs || []),
      acceptanceCriteria: unique(stepIndex === content.steps.length - 1 && stage.acceptanceGate
        ? [...(step.acceptanceCriteria || []), stage.acceptanceGate]
        : step.acceptanceCriteria || []),
      skillBindings: [],
      execution: {
        mode: "manual",
        executor: null,
        autoExecutionAllowed: false,
        approvalPolicy: content.qualityGate.level === "hard" ? "human-at-gate" : "human-before-action",
        evidenceFields: ["notes", "artifactLinks", "acceptanceResult"],
      },
    }));
    return {
      id: stage.id,
      phase: stage.phase,
      title: stage.title,
      summary: stage.summary || stage.description,
      mode: content.mode,
      applicability: "required",
      applicabilityReason: "",
      minimumAssessment: content.minimumAssessment,
      dependencies: stage.dependencies || [],
      steps,
      qualityGate: {
        ...content.qualityGate,
        criteria: unique(stage.acceptanceGate
          ? [...content.qualityGate.criteria, stage.acceptanceGate]
          : content.qualityGate.criteria),
        requiredEvidence: unique(content.qualityGate.requiredEvidence),
      },
    };
  });
  const stageLimit = DEPTH_STAGE_LIMITS[planningDepth];
  const stages = planningDepth === "full" || fullStages.length <= stageLimit
    ? fullStages
    : partitionStages(workflow.stages || [], stageLimit).map((group, groupIndex) => condensedStage({
      group,
      groupIndex,
      depth: planningDepth,
      projectBrief,
    }));
  const depthLabel = planningDepth === "quick" ? "精简" : planningDepth === "standard" ? "标准" : "完整";
  return {
    workflowId: workflow.id,
    title,
    summary: `按${depthLabel}深度编排本机 Skill，明确每一步由哪个 Skill 负责、做到什么程度，以及满足哪些条件后进入下一阶段。`,
    audience: "需要按 Skill 执行、验收和阶段门推进 Web 项目的开发者。",
    deliveryTarget: projectBrief.deploymentTarget,
    planningDepth,
    goldenStack,
    source: {
      workflowId: workflow.id,
      workflowRevision: workflow.revision,
      workflowReferenceId: workflow.reference?.id || workflow.id,
      workflowReferenceVersion: workflow.reference?.version || String(workflow.revision),
      projectBriefId: projectBrief.id,
      projectBriefVersion: projectBrief.status === "frozen" ? projectBrief.frozenVersion : 0,
      projectBriefRevision: projectBrief.revision,
      projectBriefStatus: projectBrief.status,
      projectBriefContentHash: projectBriefContentHash(projectBrief),
      projectBriefSnapshot: projectBriefSnapshot(projectBrief),
      templateId: template.id,
      templateVersion: template.version,
      templateContentHash: playbookTemplateContentHash(template),
    },
    verificationLevel: "agent-generated",
    stages,
  };
}
