import prisma from "../lib/prisma.js";
import { websiteVisitorKey } from "../middlewares/website-intake-auth.js";

const RULES = {
  upload: { limit: 30, global: 1000, seconds: 900 },
  "warranty-checkout": { limit: 5, global: 100, seconds: 600 },
  "sales-checkout": { limit: 5, global: 100, seconds: 600 },
  "marketing-checkout": { limit: 5, global: 100, seconds: 600 },
  "payment-status": { limit: 60, global: 1000, seconds: 600 },
};

async function hit(key, seconds) {
  const [row] = await prisma.$queryRaw`
    INSERT INTO "RateLimit" (key, count, "resetAt")
    VALUES (${key}, 1, now() + make_interval(secs => ${seconds}))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN "RateLimit"."resetAt" <= now() THEN 1 ELSE "RateLimit".count + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" <= now() THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END
    RETURNING count, "resetAt"`;
  return row;
}

export async function websiteGuard(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const operation = req.body?.operation;
  if (typeof operation !== "string" || !Object.hasOwn(RULES, operation)) return res.status(400).json({ message: "Invalid operation." });
  const rule = RULES[operation];
  try {
    // Only the authenticated website may request these fixed server-side rules.
    // Never accept a visitor-specified key, window, or limit.
    for (const [key, max] of [["global", rule.global], [websiteVisitorKey(req), rule.limit]]) {
      const bucket = await hit(`website-guard:${operation}:${key}`, rule.seconds);
      if (bucket.count > max) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil((new Date(bucket.resetAt).getTime() - Date.now()) / 1000))));
        return res.status(429).json({ message: "Too many requests." });
      }
    }
    if (Math.random() < 0.01) await prisma.$executeRaw`DELETE FROM "RateLimit" WHERE "resetAt" < now() - interval '1 hour'`;
    return res.json({ allowed: true });
  } catch {
    // Expensive uploads/payment calls fail closed when shared limits are unavailable.
    console.error("[Website Guard] Shared rate limit unavailable", { operation });
    return res.status(503).json({ message: "Rate limit service unavailable." });
  }
}
