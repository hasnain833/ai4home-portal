import { inngest } from "./inngest.js";

// Fire-and-forget emitter for SW-AMK automation triggers. Called from lead lifecycle
// points (created, status changed, replied, appointment booked). Never throws into the
// caller — automation is best-effort and must not break the primary action.
export async function triggerAutomation({ companyId, leadId = null, event, context = {} }) {
  if (!companyId || !event) return;
  try {
    await inngest.send({
      name: "automation.trigger",
      data: { companyId, leadId, event, context },
    });
  } catch (e) {
    console.error("[Automation] failed to emit trigger:", e?.message || e);
  }
}
