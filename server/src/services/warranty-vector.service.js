import prisma from "../lib/prisma.js";
import { embedText } from "./embedding.service.js";
import { embedChunks, retrievalStatus, saveEmbeddings, searchWithFallback, toSearchResult } from "./vector-store.service.js";

const FTS_LANG = "english";
const MAX_CHUNK_CHARS = 8000;

export async function upsertChunks(companyId, documentId, chunks, meta = {}) {
  if (!chunks.length) return 0;
  const embeddings = await embedChunks(chunks);

  await prisma.warrantyKBChunk.deleteMany({ where: { documentId } });

  const scope = meta.scope === "PLATFORM" ? "PLATFORM" : "COMPANY";

  await prisma.warrantyKBChunk.createMany({
    data: chunks.map((content, i) => ({
      companyId: scope === "PLATFORM" ? null : companyId,
      scope,
      communityId: meta.communityId || null,
      documentId,
      chunkIndex: i,
      content: String(content).slice(0, MAX_CHUNK_CHARS),
    })),
  });

  const inserted = await prisma.warrantyKBChunk.findMany({
    where: { documentId },
    orderBy: { chunkIndex: "asc" },
    select: { id: true, chunkIndex: true },
  });

  await saveEmbeddings(
    "WarrantyKBChunk",
    inserted.map((row) => ({ id: row.id, embedding: embeddings[row.chunkIndex] })),
  );

  return chunks.length;
}

export async function deleteDocument(companyId, documentId) {
  await prisma.warrantyKBChunk.deleteMany({ where: { documentId } });
}

export const queryDetailed = (companyId, text, k = 5, categories = null, communityId = null, includeSandbox = false) =>
  searchWithFallback(
    text,
    k,
    (q, limit) => semanticQuery(companyId, q, limit, categories, communityId, includeSandbox),
    (q, limit) => ftsQuery(companyId, q, limit, categories, communityId, includeSandbox),
  );

export const getRetrievalStatus = (companyId) => retrievalStatus("WarrantyKBChunk", companyId);


async function semanticQuery(companyId, text, limit, categories, communityId = null, includeSandbox = false) {
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

  const catParams = hasCats ? 1 : 0;
  const communityClause = communityId
    ? `AND (c."communityId" IS NULL OR c."communityId" = $${4 + catParams})`
    : `AND c."communityId" IS NULL`;
  const communityArgs = communityId ? [communityId] : [];

  // A literal, not a bound parameter, so adding it does not renumber $1..$4
  // above. Empty when the lab opts in.
  const sandboxClause = includeSandbox ? "" : `AND doc."isSandbox" = false`;

  try {
    const rows = hasCats
      ? await prisma.$queryRawUnsafe(
        `SELECT c.id, c."documentId", doc.name, doc.category, c.content, c.scope,
                  1 - (c.embedding <=> $1::vector) AS score
           FROM "WarrantyKBChunk" c
           JOIN "WarrantyKB" doc ON c."documentId" = doc.id
           WHERE (c.scope = 'PLATFORM' OR c."companyId" = $2)
             AND doc.category = ANY($3::text[])
             ${communityClause}
             ${sandboxClause}
             AND c.embedding IS NOT NULL
           ORDER BY c.embedding <=> $1::vector
           LIMIT $4`,
        vecStr,
        companyId,
        categories,
        limit,
        ...communityArgs,
      )
      : await prisma.$queryRawUnsafe(
        `SELECT c.id, c."documentId", doc.name, doc.category, c.content, c.scope,
                  1 - (c.embedding <=> $1::vector) AS score
           FROM "WarrantyKBChunk" c
           JOIN "WarrantyKB" doc ON c."documentId" = doc.id
           WHERE (c.scope = 'PLATFORM' OR c."companyId" = $2)
             ${communityClause}
             ${sandboxClause}
             AND c.embedding IS NOT NULL
           ORDER BY c.embedding <=> $1::vector
           LIMIT $3`,
        vecStr,
        companyId,
        limit,
        ...communityArgs,
      );

    return rows.filter((r) => Number(r.score) >= 0.3).map(toSearchResult);
  } catch (err) {
    console.error("[Vector Store] Semantic query failed (pgvector may not be set up):", err.message);
    return null;
  }
}


async function ftsQuery(companyId, text, limit, categories, communityId = null, includeSandbox = false) {
  const hasCats = Array.isArray(categories) && categories.length > 0;

  const rows = hasCats
    ? await prisma.$queryRaw`
        SELECT c.id, c."documentId", doc.name, doc.category, c.content, c.scope,
               ts_rank(to_tsvector('english'::regconfig, c.content), replace(websearch_to_tsquery(${FTS_LANG}::regconfig, ${text})::text, '&', '|')::tsquery) AS score
        FROM "WarrantyKBChunk" c
        JOIN "WarrantyKB" doc ON c."documentId" = doc.id
        WHERE (c.scope = 'PLATFORM' OR c."companyId" = ${companyId})
          AND (c."communityId" IS NULL OR c."communityId" = ${communityId})
          AND (${includeSandbox}::boolean OR doc."isSandbox" = false)
          AND doc.category = ANY(${categories})
          AND to_tsvector('english'::regconfig, c.content) @@ replace(websearch_to_tsquery(${FTS_LANG}::regconfig, ${text})::text, '&', '|')::tsquery
        ORDER BY score DESC
        LIMIT ${limit}`
    : await prisma.$queryRaw`
        SELECT c.id, c."documentId", doc.name, doc.category, c.content, c.scope,
               ts_rank(to_tsvector('english'::regconfig, c.content), replace(websearch_to_tsquery(${FTS_LANG}::regconfig, ${text})::text, '&', '|')::tsquery) AS score
        FROM "WarrantyKBChunk" c
        JOIN "WarrantyKB" doc ON c."documentId" = doc.id
        WHERE (c.scope = 'PLATFORM' OR c."companyId" = ${companyId})
          AND (c."communityId" IS NULL OR c."communityId" = ${communityId})
          AND (${includeSandbox}::boolean OR doc."isSandbox" = false)
          AND to_tsvector('english'::regconfig, c.content) @@ replace(websearch_to_tsquery(${FTS_LANG}::regconfig, ${text})::text, '&', '|')::tsquery
        ORDER BY score DESC
        LIMIT ${limit}`;

  return rows.map(toSearchResult);
}
