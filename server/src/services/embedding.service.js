let pipelineInstance = null;
let loadingPromise = null;

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIM = 384;

async function getPipeline() {
  if (pipelineInstance) return pipelineInstance;

  if (!loadingPromise) {
    loadingPromise = (async () => {
      try {
        const { pipeline, env } = await import("@xenova/transformers");
        // On a read-only serverless filesystem (Vercel) the default cache dir
        // (node_modules/.cache) can't be written, so the model download fails and
        // retrieval silently falls back to FTS. Point the cache at a writable path
        // (/tmp on serverless) so semantic search actually works there. Locally the
        // default cache is fine unless TRANSFORMERS_CACHE is set.
        if (process.env.TRANSFORMERS_CACHE) {
          env.cacheDir = process.env.TRANSFORMERS_CACHE;
        } else if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
          env.cacheDir = "/tmp/transformers-cache";
        }
        env.allowLocalModels = false; // always fetch/cache the remote model
        console.log(`[Embedding] Loading model ${MODEL_NAME} (cacheDir=${env.cacheDir})...`);
        const pipe = await pipeline("feature-extraction", MODEL_NAME, {
          quantized: true,
        });
        console.log(`[Embedding] Model loaded (${EMBEDDING_DIM}-dim vectors).`);
        pipelineInstance = pipe;
        return pipe;
      } catch (err) {
        loadingPromise = null;
        console.error("[Embedding] Failed to load model:", err.message);
        throw err;
      }
    })();
  }

  return loadingPromise;
}


export async function embedText(text) {
  if (!text || !text.trim()) return null;
  try {
    const pipe = await getPipeline();
    const output = await pipe(text, { pooling: "mean", normalize: true });
    return Array.from(output.data.slice(0, EMBEDDING_DIM));
  } catch (err) {
    console.error("[Embedding] embedText failed:", err.message);
    return null;
  }
}

export async function embedBatch(texts, batchSize = 32) {
  if (!texts || texts.length === 0) return [];
  const results = new Array(texts.length).fill(null);

  try {
    const pipe = await getPipeline();

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      for (let j = 0; j < batch.length; j++) {
        try {
          const output = await pipe(batch[j], { pooling: "mean", normalize: true });
          results[i + j] = Array.from(output.data.slice(0, EMBEDDING_DIM));
        } catch (err) {
          console.error(`[Embedding] Failed to embed chunk ${i + j}:`, err.message);
          results[i + j] = null;
        }
      }
    }
  } catch (err) {
    console.error("[Embedding] embedBatch pipeline failed:", err.message);
  }

  return results;
}


export async function preloadModel() {
  try {
    await getPipeline();
  } catch {
  }
}

export { EMBEDDING_DIM };
