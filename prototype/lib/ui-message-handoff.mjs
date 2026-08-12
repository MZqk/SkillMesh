export async function runUiMessageHandoff({ sendMessage, recordUse }) {
  if (typeof sendMessage !== "function" || typeof recordUse !== "function") {
    throw new Error("ui-message-handoff-actions-required");
  }
  await sendMessage();
  try {
    await recordUse();
    return { accepted: true, synced: true, syncError: null };
  } catch (syncError) {
    return { accepted: true, synced: false, syncError };
  }
}
