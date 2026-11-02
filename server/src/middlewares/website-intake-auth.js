import { createHash, timingSafeEqual } from "node:crypto";

export function requireWebsiteIntakeSecret(req, res, next) {
  const expected = process.env.WEBSITE_B2B_INTAKE_SECRET || "";
  const provided = req.get("X-Website-Intake-Secret");
  if (expected.length < 32) return res.status(503).json({ message: "Website intake is not configured." });
  if (typeof provided !== "string" || !timingSafeEqual(createHash("sha256").update(provided).digest(), createHash("sha256").update(expected).digest())) {
    return res.status(403).json({ message: "Forbidden" });
  }
  return next();
}

export function websiteVisitorKey(req) {
  // Trusted only after the integration credential has passed. Do not persist raw visitor IPs.
  return createHash("sha256").update(`${process.env.WEBSITE_B2B_INTAKE_SECRET}:${req.get("X-Website-Visitor") || req.ip}`).digest("hex");
}
