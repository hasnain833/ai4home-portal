import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import mammoth from "mammoth";
import { createRequire } from "module";
import { upsertChunks } from "../../services/vector-store.service.js";
import { deadLetterJob } from "../../lib/dead-letter.js";
import { resolveDownloadUrl } from "../../lib/storage.js";
import { chunkText, chunkTable, chunkSheets } from "../../lib/kb-chunking.js";
import {
  isSpreadsheetFile,
  isLegacyExcelFile,
  readSheets,
  sheetsToText,
} from "../../lib/spreadsheet.js";

export { chunkText };

const require = createRequire(import.meta.url);


async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch document (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function extractText(url, name) {
  const buffer = await fetchBuffer(url);
  const lower = (name || url).toLowerCase();

  if (isLegacyExcelFile(lower)) {
    throw new Error(
      "Legacy .xls workbooks aren't supported. Open it in Excel and save it as .xlsx, then upload again.",
    );
  }
  if (isSpreadsheetFile(lower)) return sheetsToText(readSheets(buffer));

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

async function buildChunks(sourceUrl, name) {
  if (isSpreadsheetFile(name)) {
    const sheets = readSheets(await fetchBuffer(sourceUrl));
    const rows = chunkSheets(sheets);
    return rows.length ? rows : chunkText(sheetsToText(sheets));
  }

  const text = await extractText(sourceUrl, name);
  const rows = /\.csv$/i.test(name || "") ? chunkTable(text) : [];
  return rows.length ? rows : chunkText(text);
}

export async function runKbIngestion(documentId, companyId) {
  const doc = await prisma.salesKB.findUnique({ where: { id: documentId } });
  if (!doc) return { status: "skipped", reason: "document-not-found" };

  await prisma.salesKB.update({
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
      await prisma.salesKB.update({
        where: { id: documentId },
        data: { status: "FAILED", error: "No extractable text found in document." },
      });
      return { status: "empty" };
    }

    const count = await upsertChunks(companyId, documentId, chunks, {
      name: doc.name,
      category: doc.category,
      scope: doc.scope,
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

export const ingestKbDocument = inngest.createFunction(
  {
    id: "sales-kb-ingest",
    concurrency: [{ key: "event.data.companyId", limit: 2 }],
    triggers: [{ event: "sales.kb.ingest" }],
    onFailure: async ({ event, error }) =>
      deadLetterJob({ functionId: "sales-kb-ingest", event, error }),
  },
  async ({ event }) => runKbIngestion(event.data.documentId, event.data.companyId),
);
