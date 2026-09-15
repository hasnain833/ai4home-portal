import prisma from "./prisma.js";

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

export function resolveMergedField(incoming, existing, crmOwned) {
  const inc = incoming || null;
  const exi = existing || null;
  return (crmOwned ? exi || inc : inc || exi) || null;
}
