import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// AES-256-GCM at-rest encryption for integration secrets (ERP API keys, etc.).
// Format: "<ivHex>:<authTagHex>:<cipherHex>". Backward-compatible: decryptSafe()
// returns any value that isn't in this format unchanged, so rows written before
// encryption was added (legacy plaintext) still read correctly. New writes are encrypted.
const ALGORITHM = "aes-256-gcm";
const DEFAULT_KEY = "change_me_to_a_32_char_hex_key_00";
const KEY =
  process.env.APP_ENCRYPTION_KEY ||
  process.env.SALESFORCE_ENCRYPTION_KEY ||
  DEFAULT_KEY;

if (KEY === DEFAULT_KEY) {
  console.warn(
    "[crypto] APP_ENCRYPTION_KEY/SALESFORCE_ENCRYPTION_KEY is the public default — at-rest encryption of integration secrets is NOT secure. Set a strong 32-char key.",
  );
}

const ENC_RE = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

function getKeyBuffer() {
  return Buffer.from(KEY.padEnd(32, "0").slice(0, 32), "utf-8");
}

export function encrypt(text) {
  if (text == null || text === "") return text;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKeyBuffer(), iv);
  let encrypted = cipher.update(String(text), "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedText) {
  const [ivHex, authTagHex, encrypted] = String(encryptedText).split(":");
  const decipher = createDecipheriv(ALGORITHM, getKeyBuffer(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// Decrypt if the value is in our encrypted format; otherwise return it unchanged
// (legacy plaintext, or already-decrypted). Never throws — falls back to the
// original value if decryption fails.
export function decryptSafe(value) {
  if (!value || typeof value !== "string" || !ENC_RE.test(value)) return value;
  try {
    return decrypt(value);
  } catch (e) {
    console.warn("[crypto] decryptSafe failed, returning raw value:", e.message);
    return value;
  }
}
