import { AGENT_TARGET_IDS } from "./agent-targets.mjs";
import { resolveMcpHost } from "./host-agent.mjs";

function requestedTargets(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length) throw new Error("install-targets-required");
  const targets = [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
  const unknown = targets.find((item) => !AGENT_TARGET_IDS.includes(item));
  if (unknown) throw new Error(`unknown-install-target:${unknown}`);
  return targets;
}

function inventorySummary(inventory) {
  return {
    generatedAt: inventory.generatedAt,
    paths: inventory.stats?.paths || 0,
    uniqueContent: inventory.stats?.uniqueContent || 0,
    enabled: inventory.stats?.enabled || 0,
    disabled: inventory.stats?.disabled || 0,
    providers: inventory.stats?.providers || {},
  };
}

export class SkillMeshAppService {
  constructor({ store, service, installations, quickSkills }) {
    if (!store || !service || !installations || !quickSkills) throw new Error("skillmesh-app-service-dependencies-required");
    this.store = store;
    this.service = service;
    this.installations = installations;
    this.quickSkills = quickSkills;
  }

  async snapshot({ workflowId, stageId, targetAgents, refresh = true } = {}, clientVersion = {}) {
    const host = resolveMcpHost(clientVersion);
    const targets = requestedTargets(targetAgents);
    const quickTarget = host.currentAgent || targets?.[0] || "codex";
    const inventory = await this.service.inventory({ refresh });
    const quickSnapshot = await this.quickSkills.snapshot({
      workflowId,
      stageId,
      refresh: false,
      targetAgent: quickTarget,
    });
    const quickUse = host.recognized ? quickSnapshot : {
      ...quickSnapshot,
      targetAgent: { id: "unknown", label: "未识别宿主", fixed: true },
      sections: {
        current: { items: [], total: 0, hidden: 0 },
        favorites: { items: [], total: 0, hidden: 0 },
        recent: { items: [], total: 0, hidden: 0 },
        totalVisible: 0,
        totalHidden: 0,
      },
      fallbackSummary: "当前宿主未识别；Quick Use 保持禁用且不展示其他 Agent 的可发送卡片。",
    };
    const selectedWorkflowId = quickUse.context?.workflowId || null;
    const [settings, installationGlobal, workflow, assessment, skillPlan] = await Promise.all([
      this.store.getSettings(),
      this.installations.status({ redactSensitive: true }),
      selectedWorkflowId
        ? this.store.getWorkflow(selectedWorkflowId, { redactSensitive: true })
        : null,
      selectedWorkflowId
        ? this.service.assessWorkflow(selectedWorkflowId, {
          refresh: false,
          includePaths: false,
          targetAgent: quickTarget,
        })
        : null,
      selectedWorkflowId
        ? this.service.getSkillUsagePlan(selectedWorkflowId, {
          refresh: false,
          targetAgents: targets,
          currentAgent: host.currentAgent,
        })
        : null,
    ]);
    const workflowView = workflow ? structuredClone(workflow) : null;
    if (workflowView) {
      delete workflowView.installationPlans;
      delete workflowView.suggestions;
    }

    return {
      schemaVersion: "1",
      generatedAt: new Date().toISOString(),
      host,
      featurePolicy: {
        readOnly: !host.recognized,
        messageRequiresHostCapability: true,
        downloadRequiresHostCapability: true,
        installationExecutionRequiresRecognizedHost: true,
        crossHostDispatch: false,
      },
      inventory: inventorySummary(inventory),
      settings,
      workflows: {
        items: quickUse.workflowOptions,
        activeId: selectedWorkflowId,
        activeStageId: quickUse.context?.stageId || null,
      },
      workflow: workflowView,
      assessment,
      skillPlan,
      quickUse,
      installation: {
        global: installationGlobal,
        plans: workflow?.installationPlans || [],
      },
    };
  }
}
