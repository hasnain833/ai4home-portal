import prisma from "./prisma.js";

// SW-LEAD-003: normalized duplicate detection for lead imports.
//
// Matches on a **case-insensitive email** first, then falls back to **phone by
// its last 10 digits** — ignoring formatting on BOTH the stored value and the
// incoming value (so "555-123-4567", "(555) 123 4567" and "+1 5551234567" all
// dedup to the same lead). Previously matching was exact/case-sensitive, so
// trivial variants slipped through as duplicates.
//
// Returns the existing Lead row (full) or null.
export async function findDuplicateLead(companyId, email, phone) {
  const e = (email || "").trim();
  const p10 = (phone || "").replace(/\D/g, "").slice(-10);
  if (!e && p10.length < 10) return null;

  const rows = await prisma.$queryRaw`
    SELECT id FROM "Lead"
    WHERE "companyId" = ${companyId}
      AND (
        (${e} <> '' AND lower(email) = lower(${e}))
        OR (length(${p10}) = 10 AND right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${p10})
      )
    LIMIT 1`;

  if (!rows.length) return null;
  return prisma.lead.findUnique({ where: { id: rows[0].id } });
}
