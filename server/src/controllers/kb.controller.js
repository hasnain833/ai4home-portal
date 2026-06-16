import prisma from "../lib/prisma.js";

export const getSalesKB = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const documents = await prisma.salesKB.findMany({
      where: { companyId: req.user.companyId },
      orderBy: { createdAt: "desc" },
    });

    return res.json(documents);
  } catch (error) {
    console.error("[Sales KB List] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const addSalesKBDocument = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { name, size, url, category } = req.body;

    if (!name || !size || !url) {
      return res.status(400).json({ message: "Missing required fields: name, size, url" });
    }

    const document = await prisma.salesKB.create({
      data: {
        companyId: req.user.companyId,
        name,
        size,
        url,
        category: category || "General",
      },
    });

    return res.status(201).json(document);
  } catch (error) {
    console.error("[Sales KB Create] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteSalesKBDocument = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { id } = req.params;

    const document = await prisma.salesKB.findFirst({
      where: { id, companyId: req.user.companyId },
    });

    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    await prisma.salesKB.delete({ where: { id } });

    return res.json({ success: true, message: "Document removed successfully" });
  } catch (error) {
    console.error("[Sales KB Delete] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
