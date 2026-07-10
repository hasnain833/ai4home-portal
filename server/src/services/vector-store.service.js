import prisma from "../lib/prisma.js";
import { embedText, embedBatch, EMBEDDING_DIM } from "./embedding.service.js";

const FTS_LANG = "english";
const MAX_CHUNK_CHARS = 8000;

export function isKbConfigured() {
  return true;
}

export async function upsertChunks(companyId, documentId, chunks, meta = {}) {
  if (!chunks.length) return 0;

  // Generate embeddings for all chunks in batch.
  let embeddings;
  try {
    embeddings = await embedBatch(chunks);
    const embedded = embeddings.filter(Boolean).length;
    console.log(`[Vector Store] Generated embeddings for ${embedded}/${chunks.length} chunks.`);
  } catch (err) {
    console.error("[Vector Store] Batch embedding failed, storing without embeddings:", err.message);
    embeddings = new Array(chunks.length).fill(null);
  }

  // Remove old chunks for this document.
  await prisma.salesKBChunk.deleteMany({ where: { documentId } });

  // Insert chunks with text content (Prisma createMany).
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

  // Update embeddings via raw SQL (Prisma can't handle the vector type directly).
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

// Returns { method, results } so callers can see which retrieval path answered:
//   "semantic"                -> pgvector cosine match (pgvector set up + embeddings present)
//   "fts (no semantic match)" -> pgvector ran but nothing cleared the 0.3 threshold
//   "fts (semantic unavailable)" -> pgvector/embeddings not ready (column/extension missing,
//                                     or the embedding model couldn't load) — pure keyword search
export async function queryDetailed(companyId, text, k = 5, categories = null) {
  const q = (text || "").trim();
  if (!q) return { method: "empty", results: [] };
  const limit = Math.min(Number(k) || 5, 20);

  // `null` => the semantic path failed/unavailable; `[]` => it ran but matched nothing.
  const semanticResults = await semanticQuery(companyId, q, limit, categories);
  if (semanticResults && semanticResults.length > 0) {
    return { method: "semantic", results: semanticResults };
  }

  const method = semanticResults === null ? "fts (semantic unavailable)" : "fts (no semantic match)";
  console.log(`[Vector Store] Using ${method} for query.`);
  const results = await ftsQuery(companyId, q, limit, categories);
  return { method, results };
}

export async function query(companyId, text, k = 5, categories = null) {
  const { results } = await queryDetailed(companyId, text, k, categories);
  return results;
}

// ─── Semantic (pgvector cosine similarity) search ────────────────────────────

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

    // Filter out low-relevance results (cosine similarity < 0.3).
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
    // pgvector extension might not be enabled yet, or column doesn't exist.
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

  // Check how many remain.
  const remaining = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM "SalesKBChunk" WHERE "companyId" = $1 AND embedding IS NULL`,
    companyId,
  );

  return { processed: updated, remaining: remaining[0]?.count || 0 };
}
