import { inngest } from "./inngest.js";

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
