import crypto from "crypto";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

export function getWebhookSecret() {
  return process.env.INTEGRATION_WEBHOOK_SECRET || "";
}

export function secretsMatch(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  if (!provided || !expected) return false;

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function readWebhookSecretFromHeaders(req) {
  const apiKey = req.headers?.["x-webhook-secret"] || req.headers?.["x-api-key"];
  if (typeof apiKey === "string" && apiKey.trim()) return apiKey.trim();

  const authHeader = req.headers?.authorization;
  if (typeof authHeader === "string" && authHeader.trim()) {
    return authHeader.replace(/^Bearer\s+/i, "").trim();
  }
  return "";
}

export function requireWebhookSecret(label = "Webhook") {
  return function webhookSecretGuard(req, res, next) {
    const expected = getWebhookSecret();

    if (!expected) {
      console.error(
        `[${label} Auth] INTEGRATION_WEBHOOK_SECRET is not configured — rejecting request.`,
      );
      return res.status(403).json({ message: "Forbidden" });
    }

    const provided = readWebhookSecretFromHeaders(req);
    if (!provided) {
      console.warn(`[${label} Auth] No webhook secret supplied — rejecting request.`);
      return res.status(403).json({ message: "Forbidden" });
    }

    if (!secretsMatch(provided, expected)) {
      console.warn(`[${label} Auth] Webhook secret mismatch — rejecting request.`);
      return res.status(403).json({ message: "Forbidden" });
    }

    return next();
  };
}

export function assertWebhookSecretOnBoot() {
  const secret = getWebhookSecret();
  const problems = [];
  if (!secret) problems.push("it is not set");
  else if (secret.length < 24) problems.push("it is shorter than 24 characters");

  if (problems.length === 0) return;

  const detail = problems.join("; ");
  if (IS_PRODUCTION) {
    throw new Error(
      `[webhook-auth] Refusing to start: INTEGRATION_WEBHOOK_SECRET is not usable because ${detail}. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  console.warn(
    `[webhook-auth] INTEGRATION_WEBHOOK_SECRET is weak (${detail}). Tolerated in development only — production will refuse to boot.`,
  );
}
