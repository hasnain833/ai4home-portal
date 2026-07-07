import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import mammoth from "mammoth";
import { createRequire } from "module";
import { upsertChunks, isVectorStoreConfigured } from "../../services/vector-store.service.js";

// pdf-parse ships as CommonJS; load it lazily via createRequire so importing this
// module never triggers its debug self-test.
const require = createRequire(import.meta.url);

const MAX_CHARS = 1000; // ~ target chunk size
const OVERLAP = 150;

// Split text into overlapping ~1000-char chunks on paragraph/sentence boundaries.
export function chunkText(text) {
  const clean = (text || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!clean) return [];
  const paras = clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  const chunks = [];
  let buf = "";
  for (const para of paras) {
    if ((buf + "\n\n" + para).length > MAX_CHARS && buf) {
      chunks.push(buf.trim());
      buf = buf.slice(Math.max(0, buf.length - OVERLAP)); // carry a little context
    }
    buf = buf ? `${buf}\n\n${para}` : para;
    // A single huge paragraph: hard-split it.
    while (buf.length > MAX_CHARS) {
      chunks.push(buf.slice(0, MAX_CHARS).trim());
      buf = buf.slice(MAX_CHARS - OVERLAP);
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.filter((c) => c.length > 20); // drop trivial fragments
}

async function extractText(url, name) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch document (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const lower = (name || url).toLowerCase();

  if (lower.endsWith(".pdf")) {
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(buffer);
    return data.text || "";
  }
  if (lower.endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value || "";
  }
  // .txt / .md / anything else → treat as UTF-8 text.
  return buffer.toString("utf-8");
}

// KB ingestion (SW-KB-002): extract → chunk → embed → upsert into the tenant's
// Sales vector namespace. Emitted on document upload; re-runnable on update.
export const ingestKbDocument = inngest.createFunction(
  {
    id: "sales-kb-ingest",
    concurrency: [{ key: "event.data.companyId", limit: 2 }],
    triggers: [{ event: "sales.kb.ingest" }],
  },
  async ({ event, step }) => {
    const { documentId, companyId } = event.data;

    const doc = await step.run("load-doc", async () => {
      const d = await prisma.salesKB.findUnique({ where: { id: documentId } });
      if (d) await prisma.salesKB.update({ where: { id: documentId }, data: { status: "INDEXING", error: null } });
      return d;
    });

    if (!doc) return { status: "skipped", reason: "document-not-found" };

    if (!isVectorStoreConfigured()) {
      await step.run("mark-unconfigured", async () => {
        await prisma.salesKB.update({
          where: { id: documentId },
          data: { status: "FAILED", error: "Vector store not configured (missing OPENAI_API_KEY / PINECONE_API_KEY / PINECONE_INDEX)." },
        });
      });
      return { status: "skipped", reason: "vector-store-unconfigured" };
    }

    try {
      const chunks = await step.run("extract-and-chunk", async () => {
        const text = await extractText(doc.url, doc.name);
        return chunkText(text);
      });

      if (!chunks.length) {
        await step.run("mark-empty", async () => {
          await prisma.salesKB.update({
            where: { id: documentId },
            data: { status: "FAILED", error: "No extractable text found in document." },
          });
        });
        return { status: "empty" };
      }

      const count = await step.run("embed-and-upsert", async () => {
        return upsertChunks(companyId, documentId, chunks, { name: doc.name, category: doc.category });
      });

      await step.run("mark-ready", async () => {
        await prisma.salesKB.update({
          where: { id: documentId },
          data: { status: "READY", chunkCount: count, error: null },
        });
      });

      return { status: "ready", chunks: count };
    } catch (err) {
      await step.run("mark-failed", async () => {
        await prisma.salesKB.update({
          where: { id: documentId },
          data: { status: "FAILED", error: String(err?.message || err).slice(0, 500) },
        });
      });
      throw err;
    }
  }
);
