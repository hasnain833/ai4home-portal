import { createClient } from "@supabase/supabase-js";

export const BUCKETS = {
  salesKb: "sales_knowledge_base",
  verificationDocs: "verification_docs",
  companyLogos: "company_logos",
};

const STORAGE_SCHEME = "storage://";
// 5 minutes: long enough to click through to a document, short enough that a
// leaked link is worthless. Callers needing longer (the KB ingester) pass their
// own value, so this does not need to be configurable per deployment.
export const DEFAULT_SIGNED_URL_TTL = 300;

let cachedClient = null;

export class StorageNotConfigured extends Error {
  constructor() {
    super("Server storage is not configured");
    this.name = "StorageNotConfigured";
    this.status = 500;
  }
}

export function getStorageClient() {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("[storage] Missing Supabase URL or service-role key.");
    throw new StorageNotConfigured();
  }

  cachedClient = createClient(url, serviceKey);
  return cachedClient;
}

export async function ensureBucket(bucket, { isPublic = false } = {}) {
  const client = getStorageClient();
  const { data: buckets, error } = await client.storage.listBuckets();
  if (error) {
    console.warn(`[storage] Could not list buckets (${error.message}); assuming "${bucket}" exists.`);
    return;
  }

  const existing = buckets.find((b) => b.name === bucket);
  if (!existing) {
    const { error: createError } = await client.storage.createBucket(bucket, { public: isPublic });
    if (createError) throw new Error(`Could not create bucket "${bucket}": ${createError.message}`);
    return;
  }

  if (existing.public !== isPublic) {
    const { error: updateError } = await client.storage.updateBucket(bucket, { public: isPublic });
    if (updateError) {
      console.error(
        `[storage] Failed to set bucket "${bucket}" public=${isPublic}: ${updateError.message}`,
      );
    } else {
      console.warn(`[storage] Bucket "${bucket}" visibility corrected to public=${isPublic}.`);
    }
  }
}

export function toStorageRef(bucket, key) {
  return `${STORAGE_SCHEME}${bucket}/${key}`;
}

export function parseStorageRef(value) {
  if (typeof value !== "string" || !value.startsWith(STORAGE_SCHEME)) return null;
  const rest = value.slice(STORAGE_SCHEME.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
}

export function isLegacyPublicUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

export async function uploadObject({ bucket, key, buffer, contentType, isPublic = false }) {
  const client = getStorageClient();
  await ensureBucket(bucket, { isPublic });

  const { error } = await client.storage
    .from(bucket)
    .upload(key, buffer, { contentType, upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  if (isPublic) {
    const { data } = client.storage.from(bucket).getPublicUrl(key);
    return { ref: data.publicUrl, publicUrl: data.publicUrl };
  }
  return { ref: toStorageRef(bucket, key), publicUrl: null };
}

export async function resolveDownloadUrl(stored, { expiresIn = DEFAULT_SIGNED_URL_TTL } = {}) {
  if (!stored) return null;

  const ref = parseStorageRef(stored);
  if (!ref) return isLegacyPublicUrl(stored) ? stored : null;

  const client = getStorageClient();
  const { data, error } = await client.storage
    .from(ref.bucket)
    .createSignedUrl(ref.key, expiresIn);

  if (error) {
    console.error(`[storage] Could not sign "${stored}": ${error.message}`);
    return null;
  }
  return data.signedUrl;
}


export async function deleteObject(stored) {
  const ref = parseStorageRef(stored);
  if (!ref) return { removed: false, reason: "not-a-storage-ref" };

  try {
    const client = getStorageClient();
    const { error } = await client.storage.from(ref.bucket).remove([ref.key]);
    if (error) throw new Error(error.message);
    return { removed: true };
  } catch (err) {
    console.error(`[storage] Failed to remove "${stored}":`, err?.message || err);
    return { removed: false, reason: err?.message || "unknown" };
  }
}
