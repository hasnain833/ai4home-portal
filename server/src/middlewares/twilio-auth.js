import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { verifyWebhookSecret } from "./webhook-auth.js";
import { decryptSafe } from "../lib/crypto.js";

function getRequestUrl(req) {
  if (process.env.TWILIO_WEBHOOK_BASE_URL) {
    return `${process.env.TWILIO_WEBHOOK_BASE_URL.replace(/\/$/, "")}${req.originalUrl}`;
  }
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}${req.originalUrl}`;
}

function computeSignature(authToken, url, params) {
  let data = url;
  Object.keys(params)
    .sort()
    .forEach((key) => {
      data += key + params[key];
    });
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export async function verifyTwilioSignature(req, res, next) {
  const shouldValidate = ["1", "true", "yes"].includes(
    String(process.env.TWILIO_VALIDATE_SIGNATURE || "").toLowerCase()
  );

  if (!shouldValidate) {
    return verifyWebhookSecret(req, res, next);
  }

  try {
    const signature = req.header("X-Twilio-Signature");
    if (!signature) {
      console.warn("[Twilio Auth] Missing X-Twilio-Signature header.");
      return res.status(403).json({ message: "Forbidden" });
    }

    let authToken = process.env.TWILIO_AUTH_TOKEN;
    const companyId = req.query.companyId || req.body?.companyId;
    if (companyId) {
      const integration = await prisma.integration.findFirst({
        where: { companyId, platform: "TWILIO_SMS" },
      });
      if (integration?.secretKey) authToken = decryptSafe(integration.secretKey);
    }

    if (!authToken) {
      console.warn("[Twilio Auth] No Auth Token available to validate signature.");
      return res.status(403).json({ message: "Forbidden" });
    }

    const url = getRequestUrl(req);
    const expected = computeSignature(authToken, url, req.body || {});

    const valid =
      expected.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));

    if (!valid) {
      console.warn("[Twilio Auth] Signature mismatch — rejecting webhook.");
      return res.status(403).json({ message: "Forbidden" });
    }

    return next();
  } catch (error) {
    console.error("[Twilio Auth] Validation error:", error);
    return res.status(403).json({ message: "Forbidden" });
  }
}
