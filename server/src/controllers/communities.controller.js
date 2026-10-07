import prisma from "../lib/prisma.js";
import {
  COMMUNITY_TYPES,
  COUNTED_HOMES,
  MAX_HOMES_PER_COMMUNITY,
  homeTotal,
  isCommunityType,
} from "../lib/communities.js";

const MANAGE_ROLES = ["ADMIN", "STAFF"];

const canManage = (session) => session && MANAGE_ROLES.includes(session.role);

const COUNTS = { _count: { select: { ...COUNTED_HOMES, warrantyKBs: true } } };

const withCounts = ({ _count, ...c }) => ({
  ...c,
  homeCount: homeTotal(_count),
  propertyCount: _count.properties,
  salesHomeCount: _count.salesHomes,
  kbCount: _count.warrantyKBs,
  isFull: homeTotal(_count) >= MAX_HOMES_PER_COMMUNITY,
});

export const getCommunities = async (req, res) => {
  try {
    const session = req.user;
    if (!canManage(session)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const communities = await prisma.community.findMany({
      where: { companyId: session.companyId },
      include: COUNTS,
      orderBy: { name: "asc" },
    });

    return res.json({
      communities: communities.map(withCounts),
      types: COMMUNITY_TYPES,
      maxHomes: MAX_HOMES_PER_COMMUNITY,
    });
  } catch (error) {
    console.error("Error fetching communities:", error);
    return res.status(500).json({ message: "Error fetching communities" });
  }
};

export const createCommunity = async (req, res) => {
  try {
    const session = req.user;
    if (!canManage(session)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { name, color, type } = req.body;
    const trimmed = String(name || "").trim();
    if (!trimmed) {
      return res.status(400).json({ message: "Name is required" });
    }
    if (type !== undefined && !isCommunityType(type)) {
      return res
        .status(400)
        .json({ message: `Type must be one of: ${COMMUNITY_TYPES.join(", ")}` });
    }

    const companyId = session.companyId;

    const clash = await prisma.community.findFirst({
      where: { companyId, name: { equals: trimmed, mode: "insensitive" } },
      select: { id: true },
    });
    if (clash) {
      return res.status(400).json({ message: "A community with that name already exists." });
    }

    const community = await prisma.community.create({
      data: {
        name: trimmed,
        type: type || "UNIT_HOMES",
        color: color || "#0F3B3D",
        companyId,
      },
    });

    return res.json({
      ...community,
      homeCount: 0,
      propertyCount: 0,
      salesHomeCount: 0,
      kbCount: 0,
      isFull: false,
    });
  } catch (error) {
    console.error("Error creating community:", error);
    return res.status(500).json({ message: "Error creating community" });
  }
};

export const updateCommunity = async (req, res) => {
  try {
    const session = req.user;
    if (!canManage(session)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { id } = req.params;
    const { name, color, type } = req.body;
    const companyId = session.companyId;

    const existing = await prisma.community.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) {
      return res.status(404).json({ message: "Community not found" });
    }

    if (type !== undefined && !isCommunityType(type)) {
      return res
        .status(400)
        .json({ message: `Type must be one of: ${COMMUNITY_TYPES.join(", ")}` });
    }

    const data = {};
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) return res.status(400).json({ message: "Name is required" });

      const clash = await prisma.community.findFirst({
        where: {
          companyId,
          id: { not: id },
          name: { equals: trimmed, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (clash) {
        return res.status(400).json({ message: "A community with that name already exists." });
      }
      data.name = trimmed;
    }
    if (type !== undefined) data.type = type;
    if (color !== undefined) data.color = color;

    const community = await prisma.community.update({
      where: { id },
      data,
      include: COUNTS,
    });

    return res.json(withCounts(community));
  } catch (error) {
    console.error("Error updating community:", error);
    return res.status(500).json({ message: "Error updating community" });
  }
};

export const deleteCommunity = async (req, res) => {
  try {
    const session = req.user;
    if (!canManage(session)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const id = req.params.id || req.query.id;
    if (!id) return res.status(400).json({ message: "ID required" });

    const community = await prisma.community.findFirst({
      where: { id, companyId: session.companyId },
      include: { _count: { select: { properties: true, salesHomes: true, warrantyKBs: true } } },
    });

    if (!community) {
      return res.status(404).json({ message: "Community not found" });
    }
    if (community._count.properties > 0) {
      return res.status(400).json({
        message:
          `${community.name} still has ${community._count.properties} home` +
          `${community._count.properties === 1 ? "" : "s"}. Move them to another community first.`,
      });
    }

    if (community._count.salesHomes > 0) {
      return res.status(400).json({
        message:
          `${community.name} still has ${community._count.salesHomes} home` +
          `${community._count.salesHomes === 1 ? "" : "s"} for sale. Remove or move them first.`,
      });
    }

    // Unlinked docs would fall back to "shared by all communities", turning one
    // community's rules into everyone's.
    if (community._count.warrantyKBs > 0) {
      return res.status(400).json({
        message:
          `${community.name} still has ${community._count.warrantyKBs} knowledge base document` +
          `${community._count.warrantyKBs === 1 ? "" : "s"}. Delete or move them first.`,
      });
    }

    await prisma.community.delete({ where: { id } });

    return res.json({ success: true });
  } catch (error) {
    console.error("Error deleting community:", error);
    return res.status(500).json({ message: "Error deleting community" });
  }
};
