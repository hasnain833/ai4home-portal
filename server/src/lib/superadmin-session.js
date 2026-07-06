import crypto from "crypto";

const SECRET =
  process.env.SUPERADMIN_SESSION_SECRET ||
  process.env.SESSION_SECRET ||
  "superadmin-session-secret-change-me";
const ALGORITHM = "sha256";
const DEFAULT_MAX_AGE = 60 * 60 * 24; // 1 day

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
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = encode({ ...payload, exp: expiresAt });
  const signature = sign(body);
  return `${body}.${signature}`;
}

export function verifySuperadminSessionToken(token) {
  if (!token || typeof token !== "string") return null;

  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const safeEq = crypto.timingSafeEqual(
    Buffer.from(signature, "utf8"),
    Buffer.from(expected, "utf8"),
  );
  if (!safeEq) return null;

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
