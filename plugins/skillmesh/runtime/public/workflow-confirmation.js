export const WORKFLOW_CONFIRMATION_FIELDS = [
  { key: "scopeDescription", label: "包含范围" },
  { key: "nonGoals", label: "明确不做" },
  { key: "acceptanceCriteria", label: "验收标准" },
];

export function missingWorkflowConfirmationFields(workflow) {
  if (!workflow) return WORKFLOW_CONFIRMATION_FIELDS.map(({ label }) => label);
  return WORKFLOW_CONFIRMATION_FIELDS.flatMap(({ key, label }) => {
    const value = workflow[key];
    const present = Array.isArray(value) ? value.length > 0 : String(value || "").trim().length > 0;
    return present ? [] : [label];
  });
}

export function parseWorkflowListInput(value) {
  return [...new Set(String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

export function workflowConfirmationState(workflow, { busy = false } = {}) {
  const missing = missingWorkflowConfirmationFields(workflow);
  const confirmed = workflow?.status === "confirmed";
  return {
    missing,
    canEdit: Boolean(workflow) && !busy,
    canConfirm: Boolean(workflow) && !busy && !confirmed && missing.length === 0,
    confirmed,
  };
}
