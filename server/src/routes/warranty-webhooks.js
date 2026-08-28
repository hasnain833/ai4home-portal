import { Router } from "express";
import prisma from "../lib/prisma.js";
import { inngest } from "../lib/inngest.js";
import { requireWebhookSecret } from "../middlewares/webhook-auth.js";
import { runWarrantyKbIngestion } from "../inngest/functions/warranty-kb-ingest.js";

const router = Router();

router.post("/kb-sync", requireWebhookSecret("Warranty KB Sync"), async (req, res) => {
  try {
    const { companyId, documentId } = req.body || {};

    if (!companyId && !documentId) {
      return res.status(400).json({ message: "companyId or documentId is required" });
    }

    if (documentId) {
      const doc = await prisma.warrantyKB.findUnique({
        where: { id: documentId },
        select: { id: true, companyId: true },
      });
      if (!doc) return res.status(404).json({ message: "Document not found" });

      await inngest
        .send({ name: "warranty.kb.ingest", data: { documentId: doc.id, companyId: doc.companyId } })
        .catch(async (err) => {
          console.warn("[KB Sync] Inngest unavailable, ingesting inline:", err.message);
          await runWarrantyKbIngestion(doc.id, doc.companyId);
        });

      return res.json({ ok: true, queued: 1, documentId: doc.id });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) return res.status(404).json({ message: "Company not found" });

    const docs = await prisma.warrantyKB.findMany({
      where: { companyId, isActive: true },
      select: { id: true },
    });

    if (docs.length === 0) {
      return res.json({ ok: true, queued: 0, message: "No active documents for this company." });
    }

    let queued = 0;
    for (const doc of docs) {
      try {
        await inngest.send({
          name: "warranty.kb.ingest",
          data: { documentId: doc.id, companyId },
        });
        queued += 1;
      } catch (err) {
        console.warn(`[KB Sync] Inngest send failed for ${doc.id}, ingesting inline:`, err.message);
        await runWarrantyKbIngestion(doc.id, companyId).catch((e) =>
          console.error(`[KB Sync] Inline ingestion failed for ${doc.id}:`, e.message),
        );
        queued += 1;
      }
    }

    console.log(`[KB Sync] Re-index requested for company ${companyId}: ${queued} document(s).`);
    return res.json({ ok: true, queued });
  } catch (err) {
    console.error("[KB Sync] failed:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
