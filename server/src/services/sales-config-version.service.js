import prisma from "../lib/prisma.js";

export function pickSalesConfig(company) {
  return {
    salesBrandProfile: company?.salesBrandProfile ?? null,
    voiceProfile: company?.voiceProfile ?? "professional",
    appointmentMode: company?.appointmentMode ?? "AI",
    agentMaxTurns: company?.agentMaxTurns ?? 4,
  };
}

const CONFIG_SELECT = {
  salesBrandProfile: true,
  voiceProfile: true,
  appointmentMode: true,
  agentMaxTurns: true,
};

export async function snapshotSalesConfig(companyId, { changeType = "SAVE", note = null, userId = null } = {}) {
  try {
    if (!prisma.salesConfigVersion) return null;
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: CONFIG_SELECT });
    if (!company) return null;
    const snapshot = pickSalesConfig(company);

    const latest = await prisma.salesConfigVersion.findFirst({
      where: { companyId },
      orderBy: { version: "desc" },
    });

    if (changeType === "SAVE" && latest && JSON.stringify(latest.snapshot) === JSON.stringify(snapshot)) {
      return latest;
    }

    const version = (latest?.version || 0) + 1;
    return await prisma.salesConfigVersion.create({
      data: { companyId, version, snapshot, changeType, note, createdById: userId },
    });
  } catch (e) {
    console.error("[Sales Config Version] snapshot failed:", e?.message || e);
    return null;
  }
}

export async function listSalesConfigVersions(companyId, take = 50) {
  try {
    if (!prisma.salesConfigVersion) return [];
    return await prisma.salesConfigVersion.findMany({
      where: { companyId },
      orderBy: { version: "desc" },
      take: Math.min(Number(take) || 50, 200),
    });
  } catch (e) {
    console.error("[Sales Config Version] list unavailable:", e?.message || e);
    return [];
  }
}

// Re-apply a prior snapshot to the live Company config and record the rollback.
export async function rollbackSalesConfig(companyId, version, userId = null) {
  if (!prisma.salesConfigVersion) return { ok: false, reason: "unavailable" };
  const target = await prisma.salesConfigVersion.findUnique({
    where: { companyId_version: { companyId, version: Number(version) } },
  });
  if (!target || target.companyId !== companyId) return { ok: false, reason: "version-not-found" };

  const snap = target.snapshot || {};
  await prisma.company.update({
    where: { id: companyId },
    data: {
      salesBrandProfile: snap.salesBrandProfile ?? null,
      voiceProfile: snap.voiceProfile ?? "professional",
      appointmentMode: snap.appointmentMode ?? "AI",
      agentMaxTurns: snap.agentMaxTurns ?? 4,
    },
  });

  const created = await snapshotSalesConfig(companyId, {
    changeType: "ROLLBACK",
    note: `Rolled back to v${target.version}`,
    userId,
  });
  return { ok: true, version: created, restored: target.version };
}
