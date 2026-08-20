const WINDOW_MS_DEFAULT = 60_000;
const MAX_TRACKED_KEYS = 10_000;

export function clientKey(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

export function createRateLimiter({
  windowMs = WINDOW_MS_DEFAULT,
  max = 30,
  label = "Rate limit",
  keyFn = clientKey,
} = {}) {
  /** @type {Map<string, {count:number, resetAt:number}>} */
  const buckets = new Map();

  function sweep(now) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return function rateLimitGuard(req, res, next) {
    const now = Date.now();

    if (buckets.size >= MAX_TRACKED_KEYS) sweep(now);

    const key = `${req.baseUrl || ""}${req.path || ""}:${keyFn(req)}`;
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      if (buckets.size < MAX_TRACKED_KEYS) buckets.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    const resetSeconds = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(resetSeconds));

    if (bucket.count > max) {
      res.setHeader("Retry-After", String(resetSeconds));
      console.warn(`[${label}] ${key} exceeded ${max} requests per ${windowMs}ms.`);
      return res.status(429).json({ message: "Too many requests. Please try again shortly." });
    }

    return next();
  };
}
