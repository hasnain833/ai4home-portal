import prisma from "./prisma.js";


function toSnapshot(rows) {
  return rows
    .map((m) => ({
      salesforceField: m.salesforceField,
      portalField: m.portalField,
      description: m.description ?? null,
      isActive: m.isActive ?? true,
      isConsentField: m.isConsentField ?? false,
    }))
    .sort((a, b) => a.salesforceField.localeCompare(b.salesforceField));
}

export async function snapshotMappings(companyId, { changeType, note, userId }) {
  const rows = await prisma.salesforceFieldMapping.findMany({
    where: { companyId },
    orderBy: { createdAt: "asc" },
  });

  const latest = await prisma.salesforceMappingVersion.findFirst({
    where: { companyId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const nextVersion = (latest?.version || 0) + 1;

  try {
    return await prisma.salesforceMappingVersion.create({
      data: {
        companyId,
        version: nextVersion,
        mappings: toSnapshot(rows),
        changeType,
        note: note || null,
        createdById: userId || null,
      },
    });
  } catch (e) {
    if (e?.code === "P2002") {
      console.warn(
        `[Mapping Versions] Version ${nextVersion} for company ${companyId} was taken by a concurrent edit; snapshot skipped.`,
      );
      return null;
    }
    console.error("[Mapping Versions] Snapshot failed:", e?.message || e);
    return null;
  }
}

export async function listVersions(companyId, limit = 50) {
  return prisma.salesforceMappingVersion.findMany({
    where: { companyId },
    orderBy: { version: "desc" },
    take: Math.min(Number(limit) || 50, 200),
  });
}

export async function rollbackToVersion(companyId, version, userId) {
  const target = await prisma.salesforceMappingVersion.findUnique({
    where: { companyId_version: { companyId, version: Number(version) } },
  });
  if (!target) return { success: false, reason: "Version not found" };

  const snapshot = Array.isArray(target.mappings) ? target.mappings : [];

  // Replace-in-transaction so a failure can't leave a half-restored mapping set
  // that a sync could pick up.
  await prisma.$transaction([
    prisma.salesforceFieldMapping.deleteMany({ where: { companyId } }),
    ...snapshot.map((m) =>
      prisma.salesforceFieldMapping.create({
        data: {
          companyId,
          salesforceField: m.salesforceField,
          portalField: m.portalField,
          description: m.description ?? null,
          isActive: m.isActive ?? true,
          isConsentField: m.isConsentField ?? false,
        },
      }),
    ),
  ]);

  const recorded = await snapshotMappings(companyId, {
    changeType: "ROLLBACK",
    note: `Rolled back to version ${version}`,
    userId,
  });

  return { success: true, restoredFrom: Number(version), newVersion: recorded?.version ?? null };
}
