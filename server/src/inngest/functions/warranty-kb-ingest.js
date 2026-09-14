import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import mammoth from "mammoth";
import { createRequire } from "module";
import { upsertChunks } from "../../services/warranty-vector.service.js";
import { deadLetterJob } from "../../lib/dead-letter.js";
import { resolveDownloadUrl } from "../../lib/storage.js";
import { invalidateSuggestions } from "../../services/warranty-suggestions.service.js";


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

const MIN_ROW_CELLS = 2;
const HEADER_SCAN_ROWS = 10;


function parseCsv(text) {
  const src = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (quoted) {
      if (ch !== '"') field += ch;
      else if (src[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }

  return rows.map((r) => r.map((c) => c.trim()));
}


function findHeaderRow(rows) {
  let best = -1;
  let bestFilled = MIN_ROW_CELLS - 1;

  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN_ROWS); i++) {
    const filled = rows[i].filter(Boolean).length;
    if (filled > bestFilled) { bestFilled = filled; best = i; }
  }
  return best;
}


export function chunkTable(text) {
  const rows = parseCsv(text);
  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) return [];

  const headers = rows[headerIndex].map((h, i) => h || `Column ${i + 1}`);
  const minCells = Math.max(MIN_ROW_CELLS, Math.ceil(headers.length / 2));
  const chunks = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const pairs = [];
    for (let i = 0; i < headers.length; i++) {
      const value = (row[i] || "").trim();
      if (value) pairs.push(`${headers[i]}: ${value}`);
    }
    if (pairs.length < minCells) continue;

    const body = pairs.join("\n");
    if (body.length <= MAX_CHARS) {
      chunks.push(body);
      continue;
    }

    const label = pairs[0];
    for (const piece of chunkText(body)) {
      chunks.push(piece.startsWith(label) ? piece : `${label}\n${piece}`);
    }
  }

  return chunks;
}

export async function extractText(url, name) {
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
    const text = await extractText(sourceUrl, doc.name);
    let chunks = [];
    if (/\.csv$/i.test(doc.name || "")) chunks = chunkTable(text);
    if (!chunks.length) chunks = chunkText(text);

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

    invalidateSuggestions();

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
