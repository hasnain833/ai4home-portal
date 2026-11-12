import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import { upsertChunks } from "../../services/warranty-vector.service.js";
import { deadLetterJob } from "../../lib/dead-letter.js";
import { resolveDownloadUrl } from "../../lib/storage.js";
import { buildChunks } from "./kb-ingest.js";

export async function runWarrantyKbIngestion(documentId, companyId) {
  const doc = await prisma.warrantyKB.findUnique({ where: { id: documentId } });
  if (!doc) return { status: "skipped", reason: "document-not-found" };

  await prisma.warrantyKB.update({
    where: { id: documentId },
    data: { status: "INDEXING", error: null },
  });

  try {
    const sourceUrl = await resolveDownloadUrl(doc.url, { expiresIn: 900 });
    if (!sourceUrl) {
      throw new Error("Document file is missing from storage.");
    }
    const chunks = await buildChunks(sourceUrl, doc.name);

    if (!chunks.length) {
      await prisma.warrantyKB.update({
        where: { id: documentId },
        data: { status: "FAILED", error: "No extractable text found in document." },
      });
      return { status: "empty" };
    }

    const count = await upsertChunks(companyId, documentId, chunks, {
      name: doc.name,
      category: doc.category,
      scope: doc.scope,
      communityId: doc.communityId,
    });

    await prisma.warrantyKB.update({
      where: { id: documentId },
      data: { status: "READY", chunkCount: count, error: null },
    });

    return { status: "ready", chunks: count };
  } catch (err) {
    await prisma.warrantyKB.update({
      where: { id: documentId },
      data: { status: "FAILED", error: String(err?.message || err).slice(0, 500) },
    });
    return { status: "failed", error: String(err?.message || err) };
  }
}

export const ingestWarrantyKbDocument = inngest.createFunction(
  {
    id: "warranty-kb-ingest",
    concurrency: [{ key: "event.data.companyId", limit: 2 }],
    triggers: [{ event: "warranty.kb.ingest" }],
    onFailure: async ({ event, error }) =>
      deadLetterJob({ functionId: "warranty-kb-ingest", event, error }),
  },
  async ({ event }) => runWarrantyKbIngestion(event.data.documentId, event.data.companyId),
);
