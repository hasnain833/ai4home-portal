import prisma from "./prisma.js";

export const COMMUNITY_TYPES = ["UNIT_HOMES", "SHARED_HOMES"];

export const COMMUNITY_TYPE_LABELS = {
  UNIT_HOMES: "Unit Homes",
  SHARED_HOMES: "Shared Homes",
};

export const MAX_HOMES_PER_COMMUNITY = 50;

export const isCommunityType = (value) => COMMUNITY_TYPES.includes(value);

export const COUNTED_HOMES = {
  properties: true,
  salesHomes: { where: { status: { not: "SOLD" } } },
};

export const homeTotal = (count) => count.properties + count.salesHomes;

export async function roomInCommunity(communityId, { excludePropertyId, excludeSalesHomeId } = {}) {
  const [properties, salesHomes] = await Promise.all([
    prisma.property.count({
      where: { communityId, ...(excludePropertyId ? { id: { not: excludePropertyId } } : {}) },
    }),
    prisma.salesHome.count({
      where: {
        communityId,
        status: { not: "SOLD" },
        ...(excludeSalesHomeId ? { id: { not: excludeSalesHomeId } } : {}),
      },
    }),
  ]);
  return MAX_HOMES_PER_COMMUNITY - properties - salesHomes;
}
