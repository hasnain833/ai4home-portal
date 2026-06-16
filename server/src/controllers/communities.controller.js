import prisma from "../lib/prisma.js";

export const getCommunities = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const communities = await prisma.community.findMany({
      where: { companyId: session.companyId || "demo-company" },
      orderBy: { createdAt: "desc" },
    });
    
    return res.json(communities);
  } catch (error) {
    console.error("Error fetching communities:", error);
    return res.status(500).json({ message: "Error fetching communities" });
  }
};

export const createCommunity = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "STAFF" && session.role !== "ADMIN")) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { name, color } = req.body;
    if (!name) {
      return res.status(400).json({ message: "Name is required" });
    }

    const companyId = session.companyId || "demo-company";

    const community = await prisma.community.create({
      data: {
        name,
        color: color || "#0F3B3D",
        companyId,
      },
    });

    return res.json(community);
  } catch (error) {
    console.error("Error creating community:", error);
    return res.status(500).json({ message: "Error creating community" });
  }
};

export const deleteCommunity = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "STAFF" && session.role !== "ADMIN")) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const id = req.query.id;

    if (!id) return res.status(400).json({ message: "ID required" });

    const community = await prisma.community.findFirst({
      where: { id, companyId: session.companyId || "demo-company" }
    });

    if (!community) {
      return res.status(404).json({ message: "Community not found" });
    }

    await prisma.community.delete({
      where: { id },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("Error deleting community:", error);
    return res.status(500).json({ message: "Error deleting community" });
  }
};
