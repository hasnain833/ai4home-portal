import crypto from "crypto";

// Fail closed: the super-admin session is signed with a real secret from the
// environment. There is deliberately NO hardcoded fallback — a literal default
// key would let anyone forge a valid super-admin token (full-platform bypass).
// If no sufficiently-strong secret is configured, signing throws and
// verification rejects every token, disabling super-admin auth rather than
// leaving it forgeable.
const SECRET =
  process.env.SUPERADMIN_SESSION_SECRET || process.env.SESSION_SECRET || "";
const SECRET_CONFIGURED = SECRET.length >= 16;
const ALGORITHM = "sha256";
const DEFAULT_MAX_AGE = 60 * 60 * 24; // 1 day

if (!SECRET_CONFIGURED) {
  console.error(
    "[superadmin-session] SUPERADMIN_SESSION_SECRET (or SESSION_SECRET) is not set to a value of at least 16 characters. Super Admin authentication is DISABLED until a strong secret is configured.",
  );
}

const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const decode = (value) =>
  JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

const sign = (payload) =>
  crypto.createHmac(ALGORITHM, SECRET).update(payload).digest("base64url");

export function createSuperadminSessionToken(
  payload,
  ttlSeconds = DEFAULT_MAX_AGE,
) {
  if (!SECRET_CONFIGURED) {
    throw new Error(
      "Super Admin session secret is not configured (set SUPERADMIN_SESSION_SECRET).",
    );
  }
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = encode({ ...payload, exp: expiresAt });
  const signature = sign(body);
  return `${body}.${signature}`;
}

export function verifySuperadminSessionToken(token) {
  if (!SECRET_CONFIGURED) return null;
  if (!token || typeof token !== "string") return null;

  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const signatureBuf = Buffer.from(signature, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  // timingSafeEqual throws if the buffers differ in length, so length-check
  // first (a mismatched length is itself a rejection, not a 500).
  if (signatureBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(signatureBuf, expectedBuf)) return null;

  try {
    const payload = decode(body);
    if (typeof payload !== "object" || payload === null) return null;
    if (
      typeof payload.exp !== "number" ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
