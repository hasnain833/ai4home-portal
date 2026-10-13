function splitLine(line: string) {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

/** Parse CSV text into rows keyed by field name. Headers are normalised
 *  (spaces, "_" and "-" stripped, lowercased) and looked up in `aliases`;
 *  unknown columns are dropped. */
export function parseCsv(text: string, aliases: Record<string, string>): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = splitLine(lines[0]).map((h) => h.replace(/[\s_-]+/g, "").toLowerCase());

  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      const field = aliases[h];
      if (field) row[field] = cells[i] ?? "";
    });
    return row;
  });
}
