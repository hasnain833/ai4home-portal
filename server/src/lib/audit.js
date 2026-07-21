import prisma from "./prisma.js";
export async function writeAuditLog({
  req,
  action,
  companyId,
  targetType,
  targetId,
  metadata,
} = {}) {
  try {
    if (!prisma.auditLog) {
      return;
    }
    const actor = req?.user || {};
    const ip =
      req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req?.socket?.remoteAddress ||
      null;

    await prisma.auditLog.create({
      data: {
        action,
        companyId: companyId ?? actor.companyId ?? null,
        actorId: actor.id ?? null,
        actorEmail: actor.email ?? null,
        targetType: targetType ?? null,
        targetId: targetId ?? null,
        metadata: metadata ?? undefined,
        ip,
      },
    });
  } catch (err) {
    console.warn(`[Audit] Failed to write audit log (${action}):`, err.message);
  }
}

const AUDIT_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "clientSecret",
  "apiKey",
  "secretKey",
  "smtpPass",
  "smtpPassword",
  "authToken",
  "rows",
  "leadsList",
]);

function safeBodySummary(body) {
  if (!body || typeof body !== "object") return undefined;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (SENSITIVE_KEYS.has(k)) {
      out[k] = "[redacted]";
      continue;
    }
    if (Array.isArray(v)) {
      out[k] = `[${v.length} items]`;
      continue;
    }
    if (v && typeof v === "object") {
      out[k] = "[object]";
      continue;
    }
    out[k] = typeof v === "string" ? v.slice(0, 200) : v;
  }
  return out;
}

export function auditMutations(area) {
  return (req, res, next) => {
    if (!AUDIT_METHODS.has(req.method)) return next();

    const summary = safeBodySummary(req.body);
    const routePath = req.baseUrl || req.originalUrl?.split("?")[0] || "";

    res.on("finish", () => {
      writeAuditLog({
        req,
        action: `${area.toUpperCase()}_${req.method}`,
        targetType: "Route",
        targetId: `${routePath}${req.path === "/" ? "" : req.path}`,
        metadata: {
          status: res.statusCode,
          ok: res.statusCode < 400,
          params: Object.keys(req.params || {}).length ? req.params : undefined,
          body: summary,
        },
      }).catch(() => {
        /* writeAuditLog already swallows; belt and braces */
      });
    });

    next();
  };
}
