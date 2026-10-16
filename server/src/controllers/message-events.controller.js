import prisma from "../lib/prisma.js";

// Brevo transactional events -> the MessageUsage column they stamp. Unlisted
// events are ignored: proxy_open is Apple Mail pre-loading the pixel (not a real
// open), and a soft bounce or deferral is still retried by Brevo.
const BREVO_FIELDS = {
  delivered: "deliveredAt",
  opened: "openedAt",
  unique_opened: "openedAt",
  click: "clickedAt",
  hard_bounce: "failedAt",
  blocked: "failedAt",
  invalid_email: "failedAt",
  error: "failedAt",
};

const TELNYX_FIELDS = {
  delivered: "deliveredAt",
  delivery_failed: "failedAt",
  sending_failed: "failedAt",
};

// First occurrence wins, so a repeat open or click never moves the timestamp.
async function stamp(providerMessageId, field, at) {
  if (!providerMessageId || !field) return 0;
  const { count } = await prisma.messageUsage.updateMany({
    where: { providerMessageId, [field]: null },
    data: { [field]: at },
  });
  // A click with images blocked never fires the pixel; count it as opened too
  // so the funnel never shows more clicks than opens.
  if (field === "clickedAt") {
    await prisma.messageUsage.updateMany({
      where: { providerMessageId, openedAt: null },
      data: { openedAt: at },
    });
  }
  return count;
}

export function brevoEventToStamp(evt) {
  const field = BREVO_FIELDS[evt?.event];
  const key = evt?.["X-Mailin-custom"] || null;
  const seconds = Number(evt?.ts_event || evt?.ts);
  const at = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
  return field && key ? { key, field, at } : null;
}

export const processBrevoEmailEvents = async (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    for (const evt of events) {
      const s = brevoEventToStamp(evt);
      if (s) await stamp(s.key, s.field, s.at);
    }
  } catch (error) {
    console.error("[Brevo Events] Failed to record email event:", error.message);
  }
  // Always 200: a non-2xx makes Brevo retry, and a bad row will not fix itself.
  return res.status(200).json({ received: true });
};

export async function recordTelnyxStatus(payload) {
  const field = TELNYX_FIELDS[payload?.to?.[0]?.status];
  const at = payload?.completed_at ? new Date(payload.completed_at) : new Date();
  return stamp(payload?.id, field, at);
}
