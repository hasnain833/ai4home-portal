import prisma from "./prisma.js";

// Suspension is checked on every outbound message, so the lookup is cached.
// ponytail: per-instance 60s cache; a suspend takes up to a minute to stop sends everywhere.
const TTL_MS = 60_000;
const cache = new Map();

export const SUSPENDED_MESSAGE =
  "This company's account is suspended. Please contact AI4Home support.";

export async function isCompanySuspended(companyId) {
  if (!companyId) return false;
  const hit = cache.get(companyId);
  if (hit && hit.expires > Date.now()) return hit.suspended;

  let suspended = false;
  try {
    const row = await prisma.company.findUnique({ where: { id: companyId }, select: { suspendedAt: true } });
    suspended = !!row?.suspendedAt;
  } catch (err) {
    // Fail open: a DB blip must not silently stop every tenant's messages.
    console.error("[Suspension] Lookup failed, treating as active:", err.message);
    return false;
  }
  cache.set(companyId, { suspended, expires: Date.now() + TTL_MS });
  return suspended;
}

export function forgetCompanySuspension(companyId) {
  cache.delete(companyId);
}
