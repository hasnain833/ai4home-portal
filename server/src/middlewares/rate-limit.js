import prisma from "../lib/prisma.js";

const WINDOW_MS_DEFAULT = 60_000;

export function clientKey(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

// Counters live in Postgres, not process memory: on Vercel every instance had
// its own Map, so the limit multiplied by the number of warm instances.
// One atomic upsert per request; a new window starts once resetAt has passed.
async function hit(key, windowMs) {
  const [row] = await prisma.$queryRaw`
    INSERT INTO "RateLimit" (key, count, "resetAt")
    VALUES (${key}, 1, now() + make_interval(secs => ${windowMs / 1000}))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN "RateLimit"."resetAt" <= now() THEN 1 ELSE "RateLimit".count + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" <= now() THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END
    RETURNING count, "resetAt"`;
  return row;
}

// ponytail: expired rows are swept on ~1% of hits; move to a cron if the table grows hot.
function maybeSweep() {
  if (Math.random() >= 0.01) return;
  prisma.$executeRaw`DELETE FROM "RateLimit" WHERE "resetAt" < now() - interval '1 hour'`.catch(
    (err) => console.warn("[Rate limit] Sweep failed:", err.message),
  );
}

export function createRateLimiter({
  windowMs = WINDOW_MS_DEFAULT,
  max = 30,
  label = "Rate limit",
  keyFn = clientKey,
} = {}) {
  return async function rateLimitGuard(req, res, next) {
    const key = `${req.baseUrl || ""}${req.path || ""}:${keyFn(req)}`;

    let bucket;
    try {
      bucket = await hit(key, windowMs);
    } catch (err) {
      // Fail open: a DB blip must not take the public chat down with it.
      console.error(`[${label}] Rate limit check failed, allowing request:`, err.message);
      return next();
    }
    maybeSweep();

    const resetSeconds = Math.max(0, Math.ceil((new Date(bucket.resetAt).getTime() - Date.now()) / 1000));
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    res.setHeader("X-RateLimit-Reset", String(resetSeconds));

    if (bucket.count > max) {
      res.setHeader("Retry-After", String(resetSeconds));
      console.warn(`[${label}] ${key} exceeded ${max} requests per ${windowMs}ms.`);
      return res.status(429).json({ message: "Too many requests. Please try again shortly." });
    }

    return next();
  };
}
