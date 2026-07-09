import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import mammoth from "mammoth";
import { createRequire } from "module";
import { upsertChunks } from "../../services/vector-store.service.js";


const require = createRequire(import.meta.url);
const MAX_CHARS = 1000;
const OVERLAP = 150;


export function chunkText(text) {
  const clean = (text || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!clean) return [];
  const paras = clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  const chunks = [];
  let buf = "";
  for (const para of paras) {
    if ((buf + "\n\n" + para).length > MAX_CHARS && buf) {
      chunks.push(buf.trim());
      buf = buf.slice(Math.max(0, buf.length - OVERLAP));
    }
    buf = buf ? `${buf}\n\n${para}` : para;

    while (buf.length > MAX_CHARS) {
      chunks.push(buf.slice(0, MAX_CHARS).trim());
      buf = buf.slice(MAX_CHARS - OVERLAP);
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.filter((c) => c.length > 20);
}

async function extractText(url, name) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch document (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const lower = (name || url).toLowerCase();

  if (lower.endsWith(".pdf")) {
    const mod = require("pdf-parse");

    if (typeof mod === "function") {
      const data = await mod(buffer);
      return data.text || "";
    }
    const PDFParse = mod.PDFParse || mod.default?.PDFParse;
    if (!PDFParse) throw new Error("pdf-parse: no usable parser export found");
    const parser = new PDFParse({ data: buffer });
    try {
      const data = await parser.getText();
      return data.text || "";
    } finally {
      if (typeof parser.destroy === "function") await parser.destroy();
    }
  }
  if (lower.endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value || "";
  }

  return buffer.toString("utf-8");
}


// Core ingestion: fetch → extract → chunk → store in Postgres, updating the doc's
// status as it goes. Now that there's no embedding/vector step, this is fast and
// light enough to run inline (called fire-and-forget from the upload controller),
// so KB indexing no longer depends on the Inngest dev server being up. Never
// throws — records FAILED on the document and returns a status object instead.
export async function runKbIngestion(documentId, companyId) {
  const doc = await prisma.salesKB.findUnique({ where: { id: documentId } });
  if (!doc) return { status: "skipped", reason: "document-not-found" };

  await prisma.salesKB.update({
    where: { id: documentId },
    data: { status: "INDEXING", error: null },
  });

  try {
    const text = await extractText(doc.url, doc.name);
    const chunks = chunkText(text);

    if (!chunks.length) {
      await prisma.salesKB.update({
        where: { id: documentId },
        data: { status: "FAILED", error: "No extractable text found in document." },
      });
      return { status: "empty" };
    }

    const count = await upsertChunks(companyId, documentId, chunks, {
      name: doc.name,
      category: doc.category,
    });

    await prisma.salesKB.update({
      where: { id: documentId },
      data: { status: "READY", chunkCount: count, error: null },
    });

    return { status: "ready", chunks: count };
  } catch (err) {
    await prisma.salesKB.update({
      where: { id: documentId },
      data: { status: "FAILED", error: String(err?.message || err).slice(0, 500) },
    });
    return { status: "failed", error: String(err?.message || err) };
  }
}

// Thin Inngest wrapper — retained so the flow still works if the event is ever
// dispatched via Inngest, but the primary path is a direct call from the controller.
export const ingestKbDocument = inngest.createFunction(
  {
    id: "sales-kb-ingest",
    concurrency: [{ key: "event.data.companyId", limit: 2 }],
    triggers: [{ event: "sales.kb.ingest" }],
  },
  async ({ event }) => runKbIngestion(event.data.documentId, event.data.companyId),
);
