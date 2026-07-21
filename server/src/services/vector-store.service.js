import prisma from "../lib/prisma.js";
import { embedText, embedBatch, EMBEDDING_DIM } from "./embedding.service.js";

const FTS_LANG = "english";
const MAX_CHUNK_CHARS = 8000;

export function isKbConfigured() {
  return true;
}

export async function upsertChunks(companyId, documentId, chunks, meta = {}) {
  if (!chunks.length) return 0;

  let embeddings;
  try {
    embeddings = await embedBatch(chunks);
    const embedded = embeddings.filter(Boolean).length;
    console.log(`[Vector Store] Generated embeddings for ${embedded}/${chunks.length} chunks.`);
  } catch (err) {
    console.error("[Vector Store] Batch embedding failed, storing without embeddings:", err.message);
    embeddings = new Array(chunks.length).fill(null);
  }

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

  const inserted = await prisma.salesKBChunk.findMany({
    where: { documentId },
    orderBy: { chunkIndex: "asc" },
    select: { id: true, chunkIndex: true },
  });

  for (const row of inserted) {
    const emb = embeddings[row.chunkIndex];
    if (emb) {
      const vecStr = `[${emb.join(",")}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE "SalesKBChunk" SET embedding = $1::vector WHERE id = $2`,
        vecStr,
        row.id,
      );
    }
  }

  return chunks.length;
}

export async function deleteDocument(companyId, documentId) {
  await prisma.salesKBChunk.deleteMany({ where: { documentId, companyId } });
}

export async function queryDetailed(companyId, text, k = 5, categories = null) {
  const q = (text || "").trim();
  if (!q) return { method: "empty", results: [] };
  const limit = Math.min(Number(k) || 5, 20);

  const semanticResults = await semanticQuery(companyId, q, limit, categories);
  if (semanticResults && semanticResults.length > 0) {
    return { method: "semantic", results: semanticResults };
  }

  const method = semanticResults === null ? "fts (semantic unavailable)" : "fts (no semantic match)";
  console.log(`[Vector Store] Using ${method} for query.`);
  const results = await ftsQuery(companyId, q, limit, categories);
  return { method, results };
}

export async function query(companyId, text, k = 5, categories = null, context = "unknown") {
  const { method, results } = await queryDetailed(companyId, text, k, categories);
  if (method && method.startsWith("fts")) {
    console.warn(
      `[Vector Store] ${context}: retrieval degraded to ${method} for company ${companyId}. ` +
      `Semantic search needs the pgvector setup SQL + POST /api/sales/kb/reindex.`,
    );
  }
  return results;
}

export async function getRetrievalStatus(companyId) {
  let pgvectorReady = false;
  let embeddedChunks = 0;
  let totalChunks = 0;
  let detail = null;

  try {
    totalChunks = await prisma.salesKBChunk.count({ where: { companyId } });
  } catch (err) {
    detail = `Could not count chunks: ${err.message}`;
  }

  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "SalesKBChunk" WHERE "companyId" = $1 AND embedding IS NOT NULL`,
      companyId,
    );
    embeddedChunks = rows?.[0]?.n ?? 0;
    pgvectorReady = true;
  } catch (err) {
    pgvectorReady = false;
    detail = err.message;
  }

  const coverage = totalChunks > 0 ? embeddedChunks / totalChunks : 0;
  let status = "SEMANTIC";
  if (!pgvectorReady) status = "UNAVAILABLE";
  else if (totalChunks === 0) status = "EMPTY";
  else if (embeddedChunks === 0) status = "UNAVAILABLE";
  else if (coverage < 1) status = "PARTIAL";

  return {
    status,
    pgvectorReady,
    totalChunks,
    embeddedChunks,
    coverage: Math.round(coverage * 100),
    detail,
  };
}


async function semanticQuery(companyId, text, limit, categories) {
  let queryEmbedding;
  try {
    queryEmbedding = await embedText(text);
  } catch (err) {
    console.error("[Vector Store] Query embedding failed:", err.message);
    return null;
  }
  if (!queryEmbedding) return null;

  const vecStr = `[${queryEmbedding.join(",")}]`;
  const hasCats = Array.isArray(categories) && categories.length > 0;

  try {
    const rows = hasCats
      ? await prisma.$queryRawUnsafe(
        `SELECT id, "documentId", name, category, content,
                  1 - (embedding <=> $1::vector) AS score
           FROM "SalesKBChunk"
           WHERE "companyId" = $2
             AND category = ANY($3::text[])
             AND embedding IS NOT NULL
           ORDER BY embedding <=> $1::vector
           LIMIT $4`,
        vecStr,
        companyId,
        categories,
        limit,
      )
      : await prisma.$queryRawUnsafe(
        `SELECT id, "documentId", name, category, content,
                  1 - (embedding <=> $1::vector) AS score
           FROM "SalesKBChunk"
           WHERE "companyId" = $2
             AND embedding IS NOT NULL
           ORDER BY embedding <=> $1::vector
           LIMIT $3`,
        vecStr,
        companyId,
        limit,
      );

    return rows
      .filter((r) => Number(r.score) >= 0.3)
      .map((r) => ({
        documentId: r.documentId,
        name: r.name || "",
        category: r.category || "General",
        text: r.content || "",
        score: Number(r.score) || 0,
      }));
  } catch (err) {
    console.error("[Vector Store] Semantic query failed (pgvector may not be set up):", err.message);
    return null;
  }
}


async function ftsQuery(companyId, text, limit, categories) {
  const hasCats = Array.isArray(categories) && categories.length > 0;

  const rows = hasCats
    ? await prisma.$queryRaw`
        SELECT id, "documentId", name, category, content,
               ts_rank(to_tsvector(${FTS_LANG}::regconfig, content), replace(websearch_to_tsquery(${FTS_LANG}::regconfig, ${text})::text, '&', '|')::tsquery) AS score
        FROM "SalesKBChunk"
        WHERE "companyId" = ${companyId}
          AND category = ANY(${categories})
          AND to_tsvector(${FTS_LANG}::regconfig, content) @@ replace(websearch_to_tsquery(${FTS_LANG}::regconfig, ${text})::text, '&', '|')::tsquery
        ORDER BY score DESC
        LIMIT ${limit}`
    : await prisma.$queryRaw`
        SELECT id, "documentId", name, category, content,
               ts_rank(to_tsvector(${FTS_LANG}::regconfig, content), replace(websearch_to_tsquery(${FTS_LANG}::regconfig, ${text})::text, '&', '|')::tsquery) AS score
        FROM "SalesKBChunk"
        WHERE "companyId" = ${companyId}
          AND to_tsvector(${FTS_LANG}::regconfig, content) @@ replace(websearch_to_tsquery(${FTS_LANG}::regconfig, ${text})::text, '&', '|')::tsquery
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

export async function backfillEmbeddings(companyId, batchSize = 50) {
  const chunks = await prisma.$queryRawUnsafe(
    `SELECT id, content FROM "SalesKBChunk" WHERE "companyId" = $1 AND embedding IS NULL ORDER BY "createdAt" ASC LIMIT $2`,
    companyId,
    batchSize,
  );

  if (chunks.length === 0) return { processed: 0, remaining: 0 };

  const texts = chunks.map((c) => c.content);
  const embeddings = await embedBatch(texts);

  let updated = 0;
  for (let i = 0; i < chunks.length; i++) {
    const emb = embeddings[i];
    if (emb) {
      const vecStr = `[${emb.join(",")}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE "SalesKBChunk" SET embedding = $1::vector WHERE id = $2`,
        vecStr,
        chunks[i].id,
      );
      updated++;
    }
  }

  const remaining = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM "SalesKBChunk" WHERE "companyId" = $1 AND embedding IS NULL`,
    companyId,
  );

  return { processed: updated, remaining: remaining[0]?.count || 0 };
}
