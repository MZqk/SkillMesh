import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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

export async function loadPlaybookTemplate() {
  if (!cachedTemplate) cachedTemplate = JSON.parse(await fs.readFile(TEMPLATE_PATH, "utf8"));
  return structuredClone(cachedTemplate);
}

export function playbookTemplateContentHash(template) {
  return crypto.createHash("sha256").update(JSON.stringify(template)).digest("hex");
}

export async function compilePlaybookDraft({ workflow, projectBrief }) {
  if (!workflow?.id) throw new Error("playbook-workflow-required");
  if (!projectBrief?.id || projectBrief.status !== "frozen") throw new Error("frozen-project-brief-required");
  const template = await loadPlaybookTemplate();
  const title = `${projectBrief.projectName}：从 0 到 1 开发手册`;
  const stageTitleById = new Map((workflow.stages || []).map((stage) => [stage.id, stage.title]));
  const goldenStack = projectBrief.preferredStack?.length ? projectBrief.preferredStack : DEFAULT_WEB_STACK;
  const context = templateContext(projectBrief, goldenStack);
  const templateStages = new Map(template.stages.map((stage) => [stage.id, stage]));
  const stages = (workflow.stages || []).map((stage, index) => {
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
  return {
    workflowId: workflow.id,
    title,
    summary: "按九阶段编排本机 Skill，明确每一步由哪个 Skill 负责、使用到什么程度、保存什么证据，以及满足哪些条件后才能进入下一阶段。",
    audience: "需要按 Skill 执行、验收和阶段门推进 Web 项目的开发者。",
    deliveryTarget: projectBrief.deploymentTarget,
    goldenStack,
    source: {
      workflowId: workflow.id,
      workflowRevision: workflow.revision,
      workflowReferenceId: workflow.reference?.id || workflow.id,
      workflowReferenceVersion: workflow.reference?.version || String(workflow.revision),
      projectBriefId: projectBrief.id,
      projectBriefVersion: projectBrief.frozenVersion,
      templateId: template.id,
      templateVersion: template.version,
      templateContentHash: playbookTemplateContentHash(template),
    },
    verificationLevel: "agent-generated",
    stages,
  };
}
