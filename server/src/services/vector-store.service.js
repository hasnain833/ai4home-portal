import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";

const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIM = 1536;
const UPSERT_BATCH = 100;

let _openai = null;
let _pineconeIndex = null;

export function isVectorStoreConfigured() {
  return Boolean(
    process.env.OPENAI_API_KEY &&
    process.env.PINECONE_API_KEY &&
    process.env.PINECONE_INDEX
  );
}

function openai() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set — Sales KB embeddings are unavailable.");
  }
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

function pineconeIndex() {
  if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX) {
    throw new Error("PINECONE_API_KEY / PINECONE_INDEX are not set — Sales KB vector store is unavailable.");
  }
  if (!_pineconeIndex) {
    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    _pineconeIndex = pc.index(process.env.PINECONE_INDEX);
  }
  return _pineconeIndex;
}

// Sales-workspace, per-tenant namespace.
export function salesNamespace(companyId) {
  return `sales__${companyId}`;
}

export async function embed(texts) {
  const input = Array.isArray(texts) ? texts : [texts];
  const res = await openai().embeddings.create({ model: EMBED_MODEL, input });
  return res.data.map((d) => d.embedding);
}


export async function upsertChunks(companyId, documentId, chunks, meta = {}) {
  if (!chunks.length) return 0;
  const index = pineconeIndex();
  const ns = index.namespace(salesNamespace(companyId));

  let upserted = 0;
  for (let i = 0; i < chunks.length; i += UPSERT_BATCH) {
    const batch = chunks.slice(i, i + UPSERT_BATCH);
    const embeddings = await embed(batch);
    const vectors = batch.map((text, j) => ({
      id: `${documentId}__${i + j}`,
      values: embeddings[j],
      metadata: {
        companyId,
        documentId,
        chunkIndex: i + j,
        name: meta.name || "",
        category: meta.category || "General",
        text: text.slice(0, 2000),
      },
    }));
    await ns.upsert(vectors);
    upserted += vectors.length;
  }
  return upserted;
}

export async function deleteDocument(companyId, documentId, chunkCount) {
  if (!chunkCount || chunkCount <= 0) return;
  const index = pineconeIndex();
  const ns = index.namespace(salesNamespace(companyId));
  const ids = Array.from({ length: chunkCount }, (_, i) => `${documentId}__${i}`);
  for (let i = 0; i < ids.length; i += UPSERT_BATCH) {
    await ns.deleteMany(ids.slice(i, i + UPSERT_BATCH));
  }
}

export async function query(companyId, text, k = 5, categories = null) {
  const [vector] = await embed([text]);
  const index = pineconeIndex();
  const ns = index.namespace(salesNamespace(companyId));
  const filter =
    Array.isArray(categories) && categories.length ? { category: { $in: categories } } : undefined;

  const res = await ns.query({ topK: k, vector, includeMetadata: true, filter });
  return (res.matches || []).map((m) => ({
    documentId: m.metadata?.documentId || null,
    name: m.metadata?.name || "",
    category: m.metadata?.category || "General",
    text: m.metadata?.text || "",
    score: m.score,
  }));
}
