import prisma from "../lib/prisma.js";

const FTS_LANG = "english";
const MAX_CHUNK_CHARS = 8000;

export function isKbConfigured() {
  return true;
}

export async function upsertChunks(companyId, documentId, chunks, meta = {}) {
  if (!chunks.length) return 0;
  await prisma.salesKBChunk.deleteMany({ where: { documentId } });
  await prisma.salesKBChunk.createMany({
    data: chunks.map((content, i) => ({
      companyId,
      documentId,
      chunkIndex: i,
      name: meta.name || "",
      category: meta.category || "General",
      content: String(content).slice(0, MAX_CHUNK_CHARS),
    })),
  });
  return chunks.length;
}

export async function deleteDocument(companyId, documentId) {
  await prisma.salesKBChunk.deleteMany({ where: { documentId, companyId } });
}

export async function query(companyId, text, k = 5, categories = null) {
  const q = (text || "").trim();
  if (!q) return [];
  const limit = Math.min(Number(k) || 5, 20);
  const hasCats = Array.isArray(categories) && categories.length > 0;

  // websearch_to_tsquery defaults to AND (every term must appear), which is too
  // strict for question-style KB lookups ("how much do homes cost" would miss a
  // chunk that only contains "homes"/"price"). We convert it to OR by swapping
  // the '&' operators for '|', so any matching term surfaces the chunk and
  // ts_rank orders by how well it matches. The websearch parser still safely
  // sanitizes arbitrary user input first.
  const rows = hasCats
    ? await prisma.$queryRaw`
        SELECT id, "documentId", name, category, content,
               ts_rank(to_tsvector(${FTS_LANG}::regconfig, content), replace(websearch_to_tsquery(${FTS_LANG}::regconfig, ${q})::text, '&', '|')::tsquery) AS score
        FROM "SalesKBChunk"
        WHERE "companyId" = ${companyId}
          AND category = ANY(${categories})
          AND to_tsvector(${FTS_LANG}::regconfig, content) @@ replace(websearch_to_tsquery(${FTS_LANG}::regconfig, ${q})::text, '&', '|')::tsquery
        ORDER BY score DESC
        LIMIT ${limit}`
    : await prisma.$queryRaw`
        SELECT id, "documentId", name, category, content,
               ts_rank(to_tsvector(${FTS_LANG}::regconfig, content), replace(websearch_to_tsquery(${FTS_LANG}::regconfig, ${q})::text, '&', '|')::tsquery) AS score
        FROM "SalesKBChunk"
        WHERE "companyId" = ${companyId}
          AND to_tsvector(${FTS_LANG}::regconfig, content) @@ replace(websearch_to_tsquery(${FTS_LANG}::regconfig, ${q})::text, '&', '|')::tsquery
        ORDER BY score DESC
        LIMIT ${limit}`;

  return rows.map((r) => ({
    documentId: r.documentId,
    name: r.name || "",
    category: r.category || "General",
    text: r.content || "",
    score: Number(r.score) || 0,
  }));
}
