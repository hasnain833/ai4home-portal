
export function verifyWebhookSecret(req, res, next) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[Webhook Auth] INBOUND_WEBHOOK_SECRET not set — skipping inbound webhook auth. Set it in production to secure inbound/unsubscribe endpoints.");
    return next();
  }

  const provided = req.header("X-Webhook-Token") || req.query.token;
  if (!provided || provided !== secret) {
    console.warn("[Webhook Auth] Rejected inbound webhook: missing or invalid secret token.");
    return res.status(403).json({ message: "Forbidden" });
  }
  return next();
}
