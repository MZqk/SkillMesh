import { canonicalSkills } from "./skill-identity.mjs";
import { buildQuickDeckSections } from "./quick-skill-deck.mjs";
import { resolveAgentTarget, skillSupportsTarget } from "./agent-targets.mjs";

export function isTargetCompatible(skill, targetAgent) {
  try {
    return skillSupportsTarget(skill?.supportedAgents || [], targetAgent);
  } catch {
    return false;
  }
}

function workflowTitle(workflow) {
  return workflow?.goal || workflow?.reference?.name || "未命名工作流";
}

function workflowChoice(workflow) {
  return {
    id: workflow.id,
    title: workflowTitle(workflow),
    status: workflow.status || "draft",
    stages: (workflow.stages || []).map((stage) => ({
      id: stage.id,
      title: stage.title || stage.id,
      order: stage.order ?? null,
    })),
  };
}

function selectedWorkflow(workflows, state, requestedWorkflowId) {
  const byId = new Map(workflows.map((workflow) => [workflow.id, workflow]));
  if (requestedWorkflowId !== undefined && requestedWorkflowId !== null && requestedWorkflowId !== "") {
    const requested = byId.get(String(requestedWorkflowId));
    if (!requested) throw new Error("quick-skill-workflow-not-found");
    return requested;
  }
  return byId.get(state.activeWorkflowId) || (workflows.length === 1 ? workflows[0] : null);
}

function selectedStage(workflow, state, requestedStageId) {
  if (!workflow) return null;
  const stages = workflow.stages || [];
  if (requestedStageId !== undefined && requestedStageId !== null && requestedStageId !== "") {
    const requested = stages.find((stage) => stage.id === String(requestedStageId));
    if (!requested) throw new Error("quick-skill-stage-not-found");
    return requested;
  }
  const saved = stages.find((stage) => stage.id === state.activeStageByWorkflow[workflow.id]);
  return saved || stages[0] || null;
}

export class QuickSkillService {
  constructor({ store, service }) {
    if (!store || !service) throw new Error("quick-skill-service-dependencies-required");
    this.store = store;
    this.service = service;
  }

  async snapshot({ workflowId, stageId, refresh = false, targetAgent = "codex" } = {}) {
    const target = resolveAgentTarget(targetAgent);
    const [data, state, inventory] = await Promise.all([
      this.store.read(),
      this.store.getQuickSkillState(),
      this.service.inventory({ refresh }),
    ]);
    const workflows = [...data.workflows]
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
    const workflow = selectedWorkflow(workflows, state, workflowId);
    const stage = selectedStage(workflow, state, stageId);
    const allSkills = canonicalSkills((inventory.skills || []).filter((skill) => skill.enabled !== false));
    const skills = allSkills.filter((skill) => isTargetCompatible(skill, target.id));

    let skillPlan = null;
    if (workflow) {
      skillPlan = await this.service.getSkillUsagePlan(workflow.id, { refresh: false, targetAgents: [target.id], currentAgent: target.id });
    }

    const sections = buildQuickDeckSections({
      skills,
      skillPlan,
      selectedStageId: stage?.id || null,
      preferences: state,
    });
    const compatibleHashes = new Set(skills.map((skill) => skill.contentHash));
    const allHashes = new Set(allSkills.map((skill) => skill.contentHash));
    const hiddenIncompatibleFavorites = state.favorites.filter((contentHash) =>
      allHashes.has(contentHash) && !compatibleHashes.has(contentHash)).length;
    const effectiveStageId = sections.context?.stageId || stage?.id || null;
    const effectiveStageTitle = sections.context?.stageTitle || stage?.title || null;

    return {
      schemaVersion: "1",
      generatedAt: new Date().toISOString(),
      targetAgent: { id: target.id, label: `当前 ${target.label}`, fixed: true },
      preferenceRevision: state.revision,
      state: {
        ...state,
        activeWorkflowId: workflow?.id || null,
      },
      context: {
        workflowId: workflow?.id || null,
        workflowTitle: workflow ? workflowTitle(workflow) : null,
        stageId: effectiveStageId,
        stageTitle: effectiveStageTitle,
        source: sections.context?.source || null,
        selectionRequired: !workflow && workflows.length > 1,
      },
      workflowOptions: workflows.map(workflowChoice),
      sections,
      visibility: {
        currentLimit: 6,
        favoriteLimit: 4,
        recentLimit: 4,
        maximumCards: 14,
        hiddenIncompatibleFavorites,
      },
      fallbackSummary: sections.totalVisible
        ? `SkillMesh 为当前 ${target.label} 准备了 ${sections.totalVisible} 张快速使用卡片。`
        : workflows.length > 1 && !workflow
          ? "SkillMesh 需要先选择一个工作流；收藏和最近使用仍会保留。"
          : `SkillMesh 当前没有可在 ${target.label} 中展示的快速 Skill。`,
    };
  }
}
