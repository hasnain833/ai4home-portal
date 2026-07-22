import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";


const ALGORITHM = "aes-256-gcm";
const DEFAULT_KEY = "change_me_to_a_32_char_hex_key_00";
const V2_PREFIX = "v2";
const SCRYPT_SALT = "warranty-care-portal:app-encryption:v2";
const MIN_KEY_LENGTH = 32;
const MIN_DISTINCT_CHARS = 12;

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const PRIMARY_KEY =
  process.env.APP_ENCRYPTION_KEY ||
  process.env.SALESFORCE_ENCRYPTION_KEY ||
  DEFAULT_KEY;

const PREVIOUS_KEYS = [
  ...String(process.env.APP_ENCRYPTION_KEY_PREVIOUS || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean),
  process.env.SALESFORCE_ENCRYPTION_KEY || "",
  DEFAULT_KEY,
].filter((k) => k && k !== PRIMARY_KEY);

const CANDIDATE_KEYS = [PRIMARY_KEY, ...new Set(PREVIOUS_KEYS)];

const USING_DEFAULT_KEY = PRIMARY_KEY === DEFAULT_KEY;

const V1_RE = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;
const V2_RE = /^v2:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

export function inspectKey(key) {
  const reasons = [];
  const value = String(key || "");

  if (!value) {
    reasons.push("no key is set");
  } else {
    if (value === DEFAULT_KEY) {
      reasons.push("it is the public default committed to the repo");
    }
    if (value.length < MIN_KEY_LENGTH) {
      reasons.push(`it is ${value.length} chars (minimum ${MIN_KEY_LENGTH})`);
    }
    if (new Set(value).size < MIN_DISTINCT_CHARS) {
      reasons.push(
        `it uses only ${new Set(value).size} distinct characters (minimum ${MIN_DISTINCT_CHARS}) — too predictable`,
      );
    }
    if (/^(.)\1*$/.test(value)) {
      reasons.push("it is a single repeated character");
    }
  }

  return { ok: reasons.length === 0, reasons };
}

const PRIMARY_KEY_HEALTH = inspectKey(PRIMARY_KEY);

export function encryptionKeyStatus() {
  return {
    configured: !USING_DEFAULT_KEY,
    usingDefaultKey: USING_DEFAULT_KEY,
    strong: PRIMARY_KEY_HEALTH.ok,
    problems: PRIMARY_KEY_HEALTH.reasons,
    previousKeysConfigured: PREVIOUS_KEYS.filter((k) => k !== DEFAULT_KEY).length,
    algorithm: ALGORITHM,
    format: V2_PREFIX,
  };
}

export function assertEncryptionKeyOnBoot() {
  if (PRIMARY_KEY_HEALTH.ok) return;

  const detail = PRIMARY_KEY_HEALTH.reasons.join("; ");
  if (IS_PRODUCTION) {
    throw new Error(
      `[crypto] Refusing to start: APP_ENCRYPTION_KEY is not usable because ${detail}. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  console.warn(
    `[crypto] APP_ENCRYPTION_KEY is weak (${detail}). This is tolerated in development only — production will refuse to boot.`,
  );
}

function assertKeyIsSecure() {
  if (IS_PRODUCTION && !PRIMARY_KEY_HEALTH.ok) {
    throw new Error(
      "[crypto] Refusing to encrypt provider secrets in production with a weak encryption key. Set a strong APP_ENCRYPTION_KEY.",
    );
  }
}

const v2KeyCache = new Map();
function deriveV2Key(key) {
  let derived = v2KeyCache.get(key);
  if (!derived) {
    derived = scryptSync(key, SCRYPT_SALT, 32);
    v2KeyCache.set(key, derived);
  }
  return derived;
}

function deriveV1Key(key) {
  return Buffer.from(key.padEnd(32, "0").slice(0, 32), "utf-8");
}

export function isEncrypted(value) {
  if (!value || typeof value !== "string") return false;
  return V2_RE.test(value) || V1_RE.test(value);
}

export function encrypt(text) {
  if (text == null || text === "") return text;
  assertKeyIsSecure();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, deriveV2Key(PRIMARY_KEY), iv);
  let encrypted = cipher.update(String(text), "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${V2_PREFIX}:${iv.toString("hex")}:${authTag}:${encrypted}`;
}

function decryptWith(value, key) {
  const isV2 = V2_RE.test(value);
  const parts = value.split(":");
  const [ivHex, authTagHex, encrypted] = isV2 ? parts.slice(1) : parts;
  const keyBuffer = isV2 ? deriveV2Key(key) : deriveV1Key(key);

  const decipher = createDecipheriv(ALGORITHM, keyBuffer, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function decryptDetailed(value) {
  if (!isEncrypted(value)) {
    return { value, encrypted: false, keyIndex: -1, stale: false };
  }

  for (let i = 0; i < CANDIDATE_KEYS.length; i++) {
    try {
      const plaintext = decryptWith(value, CANDIDATE_KEYS[i]);
      return {
        value: plaintext,
        encrypted: true,
        keyIndex: i,
        // Stale = readable, but not written by the current key/format.
        stale: i > 0 || !V2_RE.test(value),
      };
    } catch {
      /* wrong key or corrupt — try the next one */
    }
  }

  return { value: null, encrypted: true, keyIndex: -1, stale: false, failed: true };
}

export function decrypt(encryptedText) {
  const result = decryptDetailed(encryptedText);
  if (result.failed) {
    throw new Error("[crypto] Unable to decrypt value with any configured key.");
  }
  return result.value;
}

export function decryptSafe(value) {
  if (!isEncrypted(value)) return value;
  const result = decryptDetailed(value);
  if (result.failed) {
    console.warn("[crypto] decryptSafe: no configured key could decrypt this value; returning it raw.");
    return value;
  }
  return result.value;
}

if (USING_DEFAULT_KEY) {
  console.warn(
    "[crypto] APP_ENCRYPTION_KEY is the public default — at-rest encryption of provider secrets is NOT secure. Set a strong key (32+ chars).",
  );
}
