import assert from "node:assert/strict";
import test from "node:test";

import { runUiMessageHandoff } from "../lib/ui-message-handoff.mjs";

test("records recent use only after ui/message is accepted", async () => {
  const events = [];
  const result = await runUiMessageHandoff({
    sendMessage: async () => events.push("message"),
    recordUse: async () => events.push("recent"),
  });
  assert.deepEqual(events, ["message", "recent"]);
  assert.deepEqual(result, { accepted: true, synced: true, syncError: null });
});

test("does not record use when the host rejects ui/message", async () => {
  let recorded = false;
  await assert.rejects(runUiMessageHandoff({
    sendMessage: async () => { throw new Error("host-denied"); },
    recordUse: async () => { recorded = true; },
  }), /host-denied/);
  assert.equal(recorded, false);
});

test("reports a preference sync failure without requesting a second message", async () => {
  let sends = 0;
  const result = await runUiMessageHandoff({
    sendMessage: async () => { sends += 1; },
    recordUse: async () => { throw new Error("revision-conflict"); },
  });
  assert.equal(sends, 1);
  assert.equal(result.accepted, true);
  assert.equal(result.synced, false);
  assert.match(result.syncError.message, /revision-conflict/);
});
