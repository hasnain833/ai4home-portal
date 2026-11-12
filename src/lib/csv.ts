import { api } from "@/lib/api";

/** Rows keyed by field name, parsed on the server. Columns not in `aliases` are dropped. */
export async function parseCsv(text: string, aliases: Record<string, string>): Promise<Record<string, string>[]> {
  const data = await api.post<{ rows: Record<string, string>[] }>("/api/csv/parse", { text, aliases });
  return data.rows;
}
