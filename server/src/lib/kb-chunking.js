const MAX_CHARS = 1000;
const OVERLAP = 150;
const MIN_ROW_CELLS = 2;
const HEADER_SCAN_ROWS = 10;

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

export function parseCsv(text) {
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
export function chunkRows(rows, { label = null } = {}) {
  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) return [];

  const headers = rows[headerIndex].map((h, i) => h || `Column ${i + 1}`);
  const minCells = Math.max(MIN_ROW_CELLS, Math.ceil(headers.length / 2));
  const prefix = label ? `Sheet: ${label}` : "";
  const chunks = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const pairs = [];
    if (prefix) pairs.push(prefix);
    for (let i = 0; i < headers.length; i++) {
      const value = (row[i] || "").trim();
      if (value) pairs.push(`${headers[i]}: ${value}`);
    }
    // The prefix is context, not content — it must not make an empty row count.
    if (pairs.length - (prefix ? 1 : 0) < minCells) continue;

    const body = pairs.join("\n");
    if (body.length <= MAX_CHARS) {
      chunks.push(body);
      continue;
    }

    const first = pairs[prefix ? 1 : 0];
    for (const piece of chunkText(body)) {
      chunks.push(piece.startsWith(prefix || first) ? piece : `${prefix ? `${prefix}\n` : ""}${first}\n${piece}`);
    }
  }

  return chunks;
}

export function chunkTable(text) {
  return chunkRows(parseCsv(text));
}

/** Row chunks for every sheet of a workbook, tagged by tab when there are several. */
export function chunkSheets(sheets) {
  const many = sheets.length > 1;
  return sheets.flatMap((sheet) => chunkRows(sheet.rows, { label: many ? sheet.name : null }));
}
