/** Rows keyed by field name, parsed on the server. Columns not in `aliases` are dropped. */
export async function parseCsv(text: string, aliases: Record<string, string>): Promise<Record<string, string>[]> {
  const response = await fetch("/api/csv/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, aliases }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Could not read that file.");
  return data.rows;
}
