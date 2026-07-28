export class UploadRejected extends Error {
  constructor(message, { status = 400, code = "UPLOAD_REJECTED" } = {}) {
    super(message);
    this.name = "UploadRejected";
    this.status = status;
    this.code = code;
  }
}

const MB = 1024 * 1024;

const SIGNATURES = {
  pdf: [{ bytes: [0x25, 0x50, 0x44, 0x46] }], // %PDF
  png: [{ bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  jpg: [{ bytes: [0xff, 0xd8, 0xff] }],
  gif: [{ bytes: [0x47, 0x49, 0x46, 0x38] }], // GIF8
  webp: [{ bytes: [0x52, 0x49, 0x46, 0x46] }, { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }],
  // DOCX/XLSX are ZIP containers.
  zip: [
    { bytes: [0x50, 0x4b, 0x03, 0x04] },
    { bytes: [0x50, 0x4b, 0x05, 0x06] },
    { bytes: [0x50, 0x4b, 0x07, 0x08] },
  ],
};

const TYPES = {
  pdf: { ext: ["pdf"], mime: ["application/pdf"], magic: "pdf" },
  docx: {
    ext: ["docx"],
    mime: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    magic: "zip",
  },
  txt: { ext: ["txt", "md"], mime: ["text/plain", "text/markdown"], magic: null },
  csv: { ext: ["csv"], mime: ["text/csv", "application/csv", "text/plain"], magic: null },
  png: { ext: ["png"], mime: ["image/png"], magic: "png" },
  jpg: { ext: ["jpg", "jpeg"], mime: ["image/jpeg", "image/jpg"], magic: "jpg" },
  gif: { ext: ["gif"], mime: ["image/gif"], magic: "gif" },
  webp: { ext: ["webp"], mime: ["image/webp"], magic: "webp" },
};

// Presets used by the upload routes.
export const UPLOAD_PROFILES = {
  kbDocument: { types: ["pdf", "docx", "txt", "csv"], maxBytes: 25 * MB, label: "knowledge base document" },
  image: { types: ["png", "jpg", "gif", "webp"], maxBytes: 5 * MB, label: "image" },
  verificationDoc: { types: ["png", "jpg", "webp", "pdf"], maxBytes: 10 * MB, label: "verification document" },
};

function extensionOf(filename) {
  const match = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function matchesSignature(buffer, magicKey) {
  const groups = SIGNATURES[magicKey];
  if (!groups) return true;

  const byOffset = new Map();
  for (const g of groups) {
    const offset = g.offset || 0;
    if (!byOffset.has(offset)) byOffset.set(offset, []);
    byOffset.get(offset).push(g.bytes);
  }

  for (const [offset, alternatives] of byOffset) {
    const ok = alternatives.some((bytes) =>
      bytes.every((b, i) => buffer[offset + i] === b),
    );
    if (!ok) return false;
  }
  return true;
}

function looksLikeText(buffer) {
  const sample = buffer.subarray(0, 8192);
  if (sample.includes(0)) return false;

  let control = 0;
  for (const byte of sample) {
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) control++;
  }
  return control / (sample.length || 1) < 0.05;
}

const ACTIVE_CONTENT_RE = /<\s*(script|iframe|embed|object)\b|<\s*svg\b|javascript\s*:/i;


export function safeFileName(filename, fallback = "file") {
  const base = String(filename || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop();
  const cleaned = String(base || "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned || fallback;
}

export function buildStorageKey(companyId, filename, fallback = "file") {
  return `${companyId}/${Date.now()}_${safeFileName(filename, fallback)}`;
}

function validateStructure(file, profile) {
  const buffer = file.buffer;
  if (!buffer || !buffer.length) {
    throw new UploadRejected("The uploaded file is empty.");
  }
  if (buffer.length > profile.maxBytes) {
    throw new UploadRejected(
      `That ${profile.label} is ${(buffer.length / MB).toFixed(1)}MB. The limit is ${profile.maxBytes / MB}MB.`,
      { status: 413 },
    );
  }

  const ext = extensionOf(file.originalname);
  const mime = String(file.mimetype || "").toLowerCase().split(";")[0].trim();

  const allowed = profile.types
    .map((t) => ({ key: t, ...TYPES[t] }))
    .filter(Boolean);

  const byExtension = allowed.find((t) => t.ext.includes(ext));
  if (!byExtension) {
    const list = allowed.flatMap((t) => t.ext).join(", ");
    throw new UploadRejected(
      `"${safeFileName(file.originalname)}" isn't an accepted ${profile.label}. Allowed types: ${list}.`,
    );
  }

  if (mime && !byExtension.mime.includes(mime)) {
    throw new UploadRejected(
      `The file's declared type (${mime}) doesn't match its .${ext} extension.`,
    );
  }

  if (byExtension.magic) {
    if (!matchesSignature(buffer, byExtension.magic)) {
      throw new UploadRejected(
        `That file's contents don't match a real .${ext} file. It may be renamed or corrupt.`,
      );
    }
  } else {
    if (!looksLikeText(buffer)) {
      throw new UploadRejected(
        `That .${ext} file contains binary data rather than text. It may be renamed or corrupt.`,
      );
    }
    if (ACTIVE_CONTENT_RE.test(buffer.subarray(0, 8192).toString("utf-8"))) {
      throw new UploadRejected(
        `That .${ext} file contains embedded scripts or markup, which isn't allowed.`,
      );
    }
  }

  return { ext, mime: mime || byExtension.mime[0], type: byExtension.key };
}

export async function assertUploadSafe(file, profileName) {
  const profile = UPLOAD_PROFILES[profileName];
  if (!profile) throw new Error(`Unknown upload profile "${profileName}"`);

  return validateStructure(file, profile);
}
