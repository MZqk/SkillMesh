import { publicPlaybook } from "./playbook-model.mjs";

const MAX_CHANGES = 500;

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function preview(value, maximum = 500) {
  if (value === undefined) return null;
  const rendered = typeof value === "string" ? value : JSON.stringify(value);
  return rendered.length > maximum ? `${rendered.slice(0, maximum)}…` : rendered;
}

function pushChange(changes, change) {
  if (changes.length >= MAX_CHANGES) return;
  changes.push({
    ...change,
    before: preview(change.before),
    after: preview(change.after),
  });
}

function compareField(changes, path, label, before, after) {
  if (same(before, after)) return;
  pushChange(changes, { type: "changed", path, label, before, after });
}

const PLAYBOOK_FIELDS = [
  ["title", "手册标题"],
  ["summary", "手册说明"],
  ["audience", "目标读者"],
  ["deliveryTarget", "交付目标"],
  ["goldenStack", "黄金路径技术栈"],
  ["source", "生成来源"],
  ["skillBindingAssessment", "Skill 评估来源"],
];

const STAGE_FIELDS = [
  ["title", "阶段标题"],
  ["summary", "阶段说明"],
  ["mode", "工作模式"],
  ["applicability", "阶段适用性"],
  ["applicabilityReason", "不适用原因"],
  ["minimumAssessment", "最低判断"],
  ["dependencies", "阶段依赖"],
  ["qualityGate", "质量门"],
];

const STEP_FIELDS = [
  ["title", "步骤标题"],
  ["objective", "步骤目标"],
  ["requiredCapabilities", "所需能力"],
  ["prerequisites", "前置条件"],
  ["actions", "操作"],
  ["prompt", "提示词"],
  ["commands", "命令"],
  ["expectedOutputs", "预期产出"],
  ["acceptanceCriteria", "验收标准"],
  ["failureModes", "失败恢复"],
  ["evidenceRequirements", "证据要求"],
  ["skillBindings", "Skill 绑定"],
  ["skillGaps", "Skill 缺口"],
  ["execution", "执行策略"],
];

export function diffPlaybooks(current, base = null) {
  const currentView = publicPlaybook(current);
  const baseView = base ? publicPlaybook(base) : null;
  const changes = [];
  if (!baseView) {
    for (const stage of currentView.stages) {
      pushChange(changes, {
        type: "added",
        path: `stages.${stage.id}`,
        label: `新增阶段：${stage.title}`,
        before: null,
        after: `${stage.steps.length} 个步骤 · ${stage.qualityGate.level === "hard" ? "硬门" : "软门"}`,
      });
    }
  } else {
    for (const [field, label] of PLAYBOOK_FIELDS) {
      compareField(changes, field, label, baseView[field], currentView[field]);
    }
    const baseStages = new Map(baseView.stages.map((stage) => [stage.id, stage]));
    const currentStages = new Map(currentView.stages.map((stage) => [stage.id, stage]));
    for (const stage of currentView.stages) {
      const prior = baseStages.get(stage.id);
      if (!prior) {
        pushChange(changes, { type: "added", path: `stages.${stage.id}`, label: `新增阶段：${stage.title}`, before: null, after: `${stage.steps.length} 个步骤` });
        continue;
      }
      for (const [field, label] of STAGE_FIELDS) {
        compareField(changes, `stages.${stage.id}.${field}`, `${stage.title} · ${label}`, prior[field], stage[field]);
      }
      const baseSteps = new Map(prior.steps.map((step) => [step.id, step]));
      const currentSteps = new Map(stage.steps.map((step) => [step.id, step]));
      for (const step of stage.steps) {
        const priorStep = baseSteps.get(step.id);
        if (!priorStep) {
          pushChange(changes, { type: "added", path: `stages.${stage.id}.steps.${step.id}`, label: `${stage.title} · 新增步骤：${step.title}`, before: null, after: step.objective });
          continue;
        }
        for (const [field, label] of STEP_FIELDS) {
          compareField(changes, `stages.${stage.id}.steps.${step.id}.${field}`, `${stage.title} / ${step.title} · ${label}`, priorStep[field], step[field]);
        }
      }
      for (const step of prior.steps) {
        if (!currentSteps.has(step.id)) pushChange(changes, {
          type: "removed",
          path: `stages.${stage.id}.steps.${step.id}`,
          label: `${stage.title} · 移除步骤：${step.title}`,
          before: step.objective,
          after: null,
        });
      }
    }
    for (const stage of baseView.stages) {
      if (!currentStages.has(stage.id)) pushChange(changes, {
        type: "removed",
        path: `stages.${stage.id}`,
        label: `移除阶段：${stage.title}`,
        before: `${stage.steps.length} 个步骤`,
        after: null,
      });
    }
  }
  const summary = {
    initialVersion: !baseView,
    total: changes.length,
    added: changes.filter((item) => item.type === "added").length,
    changed: changes.filter((item) => item.type === "changed").length,
    removed: changes.filter((item) => item.type === "removed").length,
    truncated: changes.length >= MAX_CHANGES,
  };
  return {
    schemaVersion: "1",
    playbookId: currentView.id,
    workflowId: currentView.workflowId,
    baseVersion: baseView?.confirmedVersion || 0,
    baseContentHash: baseView?.contentHash || null,
    currentRevision: currentView.revision,
    currentContentHash: currentView.contentHash,
    summary,
    changes,
  };
}
