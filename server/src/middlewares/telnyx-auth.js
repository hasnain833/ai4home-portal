import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { decryptSafe } from "../lib/crypto.js";

// Telnyx signs webhooks with Ed25519 over `${timestamp}|${rawBody}` and sends the
// signature base64-encoded in `telnyx-signature-ed25519`. The verifying key is the
// account's Public Key from the Telnyx portal (stored as the integration secret).
const TOLERANCE_SECONDS = 5 * 60;

function toEd25519PublicKey(base64Key) {
  // Telnyx exposes a bare 32-byte Ed25519 key; wrap it in the SPKI DER prefix
  // that Node's crypto expects.
  const raw = Buffer.from(base64Key, "base64");
  if (raw.length !== 32) return null;
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  return crypto.createPublicKey({
    key: Buffer.concat([prefix, raw]),
    format: "der",
    type: "spki",
  });
}

export async function verifyTelnyxSignature(req, res, next) {
  try {
    const signature = req.header("telnyx-signature-ed25519");
    const timestamp = req.header("telnyx-timestamp");

    if (!signature || !timestamp) {
      console.warn("[Telnyx Auth] Missing telnyx-signature-ed25519/telnyx-timestamp header.");
      return res.status(403).json({ message: "Forbidden" });
    }

    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
    if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) {
      console.warn("[Telnyx Auth] Timestamp outside tolerance — rejecting webhook.");
      return res.status(403).json({ message: "Forbidden" });
    }

    let publicKey = process.env.TELNYX_PUBLIC_KEY;
    const companyId = req.query.companyId || req.body?.companyId;
    if (companyId) {
      const integration = await prisma.integration.findFirst({
        where: { companyId, platform: "TELNYX_SMS" },
      });
      if (integration?.secretKey) publicKey = decryptSafe(integration.secretKey);
    }

    if (!publicKey) {
      console.warn("[Telnyx Auth] No Public Key available to validate signature.");
      return res.status(403).json({ message: "Forbidden" });
    }

    const key = toEd25519PublicKey(publicKey);
    if (!key) {
      console.warn("[Telnyx Auth] Public Key is not a valid 32-byte Ed25519 key.");
      return res.status(403).json({ message: "Forbidden" });
    }

    // Signature covers the exact bytes Telnyx sent, so verify against the raw body.
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), "utf-8");
    const signedPayload = Buffer.concat([Buffer.from(`${timestamp}|`, "utf-8"), rawBody]);

    const valid = crypto.verify(null, signedPayload, key, Buffer.from(signature, "base64"));

    if (!valid) {
      console.warn("[Telnyx Auth] Signature mismatch — rejecting webhook.");
      return res.status(403).json({ message: "Forbidden" });
    }

    return next();
  } catch (error) {
    console.error("[Telnyx Auth] Validation error:", error);
    return res.status(403).json({ message: "Forbidden" });
  }
}
