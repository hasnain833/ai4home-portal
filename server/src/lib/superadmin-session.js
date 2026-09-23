import crypto from "crypto";
const SECRET = process.env.SESSION_SECRET || "";
const SECRET_CONFIGURED = SECRET.length >= 16;
const ALGORITHM = "sha256";
const MAX_AGE_DAYS = Number(process.env.SESSION_MAX_AGE_DAYS || 90);
const DEFAULT_MAX_AGE = 60 * 60 * 24 * MAX_AGE_DAYS;
const RENEW_AFTER_RATIO = 0.5;

export const SESSION_MAX_AGE_SECONDS = DEFAULT_MAX_AGE;
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: DEFAULT_MAX_AGE * 1000,
};

export function shouldRenewSuperadminSession(payload) {
  if (!payload || typeof payload.exp !== "number") return false;
  const remaining = payload.exp - Math.floor(Date.now() / 1000);
  return remaining < DEFAULT_MAX_AGE * RENEW_AFTER_RATIO;
}

if (!SECRET_CONFIGURED) {
  console.error(
    "[superadmin-session] SESSION_SECRET is not set to a value of at least 16 characters. Super Admin authentication is DISABLED until a strong secret is configured.",
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
      "Super Admin session secret is not configured (set SESSION_SECRET).",
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
