import AdmZip from "adm-zip";

const MAX_ROWS = 20000;
const MAX_COLUMNS = 256;
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const BUILTIN_PERCENT_FORMATS = new Set([9, 10]);

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function isSpreadsheetFile(name) {
  return /\.xlsx$/i.test(String(name || ""));
}

export function isLegacyExcelFile(name) {
  return /\.xls$/i.test(String(name || ""));
}

function decodeEntities(value) {
  return String(value).replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g,
    (match, dec, hex, named) => {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      const mapped = NAMED_ENTITIES[named.toLowerCase()];
      return mapped === undefined ? match : mapped;
    },
  );
}

function textRuns(xml) {
  let out = "";
  const re = /<t\b[^>]*\/>|<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let match;
  while ((match = re.exec(xml))) {
    if (match[1]) out += decodeEntities(match[1]);
  }
  return out;
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? decodeEntities(match[1]) : null;
}

function entryText(zip, path) {
  const entry = zip.getEntry(path);
  return entry ? zip.readAsText(entry, "utf8") : null;
}

function readSharedStrings(zip) {
  const xml = entryText(zip, "xl/sharedStrings.xml");
  if (!xml) return [];

  const strings = [];
  const re = /<si\b[^>]*\/>|<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match;
  while ((match = re.exec(xml))) {
    strings.push(match[1] ? textRuns(match[1]) : "");
  }
  return strings;
}

function readNumberStyles(zip) {
  const xml = entryText(zip, "xl/styles.xml");
  if (!xml) return [];

  const custom = new Map();
  const numFmtRe = /<numFmt\b[^>]*\/>/g;
  let match;
  while ((match = numFmtRe.exec(xml))) {
    const id = Number(attr(match[0], "numFmtId"));
    const code = attr(match[0], "formatCode") || "";
    if (!Number.isFinite(id)) continue;
    if (looksLikeDateFormat(code)) custom.set(id, "date");
    else if (isPercentFormat(code)) custom.set(id, "percent");
  }

  const cellXfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!cellXfs) return [];

  const styles = [];
  const xfRe = /<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g;
  while ((match = xfRe.exec(cellXfs[1]))) {
    const id = Number(attr(match[0], "numFmtId") || 0);
    if (BUILTIN_DATE_FORMATS.has(id)) styles.push("date");
    else if (BUILTIN_PERCENT_FORMATS.has(id)) styles.push("percent");
    else styles.push(custom.get(id) || null);
  }
  return styles;
}

function isPercentFormat(code) {
  return String(code).replace(/"[^"]*"/g, "").replace(/\\./g, "").includes("%");
}

function looksLikeDateFormat(code) {
  const placeholders = String(code)
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "");
  return /[dmy]/i.test(placeholders) && !/(^|[^\\])(General|@)/.test(placeholders);
}

function serialToDateString(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return String(serial);

  const iso = date.toISOString();
  return Number.isInteger(serial) ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
}

function columnIndex(ref) {
  const letters = String(ref || "").match(/^[A-Z]+/i);
  if (!letters) return -1;

  let index = 0;
  for (const ch of letters[0].toUpperCase()) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

function cellValue(tag, body, { sharedStrings, numberStyles }) {
  const type = attr(tag, "t") || "n";

  if (type === "inlineStr") return textRuns(body);
  if (type === "s") {
    const index = Number(textRuns(body) || (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1]);
    return sharedStrings[index] ?? "";
  }

  const raw = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
  if (!raw) return "";
  const value = decodeEntities(raw);

  if (type === "b") return value === "1" ? "TRUE" : "FALSE";
  if (type === "e") return "";
  if (type === "str" || type === "d") return value;

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;

  const styleIndex = Number(attr(tag, "s"));
  const format = Number.isFinite(styleIndex) ? numberStyles[styleIndex] : null;
  if (format === "date" && numeric > 0) return serialToDateString(numeric);
  if (format === "percent") return `${trimNumber(numeric * 100)}%`;

  return trimNumber(numeric);
}

function trimNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(10)));
}

function readSheetRows(xml, context) {
  const rows = [];
  const rowRe = /<row\b[^>]*\/>|<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = rowRe.exec(xml)) && rows.length < MAX_ROWS) {
    const row = [];
    if (rowMatch[1]) {
      const cellRe = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      let cellMatch;
      let next = 0;

      while ((cellMatch = cellRe.exec(rowMatch[1]))) {
        const tag = `<c${cellMatch[1] ?? cellMatch[2]}>`;
        const value = cellMatch[1] ? "" : cellValue(tag, cellMatch[3], context);
        const at = columnIndex(attr(tag, "r"));
        const index = at >= 0 ? at : next;
        if (index >= MAX_COLUMNS) continue;
        while (row.length < index) row.push("");
        row[index] = value;
        next = index + 1;
      }
    }
    rows.push(row.map((c) => String(c ?? "").trim()));
  }

  while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop();
  return rows;
}

function sheetPaths(zip) {
  const workbook = entryText(zip, "xl/workbook.xml");
  const rels = entryText(zip, "xl/_rels/workbook.xml.rels");

  const targets = new Map();
  if (rels) {
    const re = /<Relationship\b[^>]*\/>/g;
    let match;
    while ((match = re.exec(rels))) {
      const id = attr(match[0], "Id");
      const target = attr(match[0], "Target");
      if (id && target) targets.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
    }
  }

  const sheets = [];
  if (workbook) {
    const re = /<sheet\b[^>]*\/>/g;
    let match;
    while ((match = re.exec(workbook))) {
      const name = attr(match[0], "name") || `Sheet ${sheets.length + 1}`;
      const relId = attr(match[0], "r:id") || attr(match[0], "relationshipId");
      const target = relId ? targets.get(relId) : null;
      if (target) sheets.push({ name, path: `xl/${target}` });
    }
  }

  if (sheets.length) return sheets;

  return zip
    .getEntries()
    .map((e) => e.entryName)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((path, i) => ({ name: `Sheet ${i + 1}`, path }));
}

export function readSheets(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error("That .xlsx file could not be opened. It may be corrupt.");
  }

  const context = {
    sharedStrings: readSharedStrings(zip),
    numberStyles: readNumberStyles(zip),
  };

  const sheets = [];
  for (const { name, path } of sheetPaths(zip)) {
    const xml = entryText(zip, path);
    if (!xml) continue;
    const rows = readSheetRows(xml, context);
    if (rows.length) sheets.push({ name, rows });
  }
  return sheets;
}

export function sheetsToText(sheets) {
  return sheets
    .map(({ name, rows }) => {
      const body = rows.map((r) => r.filter(Boolean).join(" | ")).filter(Boolean).join("\n");
      return body ? `Sheet: ${name}\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}
