import prisma from "../lib/prisma.js";
import { inngest } from "../lib/inngest.js";
import { parseWebsiteInquiry, storeWebsiteInquiry } from "../lib/website-inquiry.js";
import { autoEnrollSoon } from "../services/b2b-auto-nurture.js";

export async function websiteIntake(req, res) {
  const id = req.get("Idempotency-Key") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return res.status(400).json({ message: "Invalid request ID." });
  let payload;
  try { payload = parseWebsiteInquiry(req.body); }
  catch (error) { return res.status(400).json({ message: error.message }); }
  try {
    const inquiry = await storeWebsiteInquiry(prisma, id, payload);
    // The cron also sweeps persisted pending deliveries if event publication fails.
    await inngest.send({ name: "b2b.website-inquiry.saved", data: { inquiryId: inquiry.id } }).catch(() => console.error("[Website intake] Delivery queued for cron recovery"));
    // Speed-to-lead: the 180-day nurture starts now, not at the next 15-minute sweep.
    void autoEnrollSoon();
    return res.status(202).json({ success: true, delivery: "pending" });
  } catch (error) {
    console.error("[Website intake] Could not store inquiry:", error.code || error.status || "unknown");
    return res.status(error.status === 409 ? 409 : 503).json({ message: error.status === 409 ? error.message : "Unable to save your inquiry. Please try again." });
  }
}
