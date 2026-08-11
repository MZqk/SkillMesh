export function validateQuickUseForm({ task, expectedOutputs } = {}) {
  const cleanTask = String(task || "").trim();
  const outputs = [...new Set((expectedOutputs || []).map((item) => String(item || "").trim()).filter(Boolean))];
  if (!cleanTask) return { valid: false, field: "task", message: "请填写任务。", task: cleanTask, expectedOutputs: outputs };
  if (!outputs.length) return { valid: false, field: "outputs", message: "请至少填写一项预期产物。", task: cleanTask, expectedOutputs: outputs };
  return { valid: true, field: null, message: "", task: cleanTask, expectedOutputs: outputs };
}

export async function runQuickUseHandoff({ send, recordUse }) {
  if (typeof send !== "function" || typeof recordUse !== "function") throw new Error("quick-use-actions-required");
  await send();
  try {
    await recordUse();
    return { sent: true, synced: true, syncError: null };
  } catch (syncError) {
    return { sent: true, synced: false, syncError };
  }
}

