import prisma from "../lib/prisma.js";

export const getProperties = async (req, res) => {
  try {
    const session = req.user;
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (session.role === "HOMEOWNER") {
      const properties = await prisma.property.findMany({
        where: { homeownerId: session.id },
        orderBy: { createdAt: "desc" },
      });
      return res.json(properties);
    } else {
      // Admins and Staff: fetch all properties under their company
      const properties = await prisma.property.findMany({
        where: {
          homeowner: {
            companyId: session.companyId || undefined,
          },
        },
        include: {
          homeowner: {
            select: { name: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      return res.json(properties);
    }
  } catch (error) {
    console.error("Fetch properties error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createProperty = async (req, res) => {
  try {
    const session = req.user;
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { address, city, state, zipCode, coeDate, areaOfHome, homeownerId, coverageTerm } = req.body;

    if (!address) {
      return res.status(400).json({ message: "Address is required" });
    }

    let assignedHomeownerId;

    if (session.role === "HOMEOWNER") {
      assignedHomeownerId = session.id;
    } else if (session.role === "ADMIN" || session.role === "STAFF") {
      if (!homeownerId) {
        return res.status(400).json({ message: "Homeowner is required" });
      }
      assignedHomeownerId = homeownerId;
    } else {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Denormalize companyId for tenant-scoped queries. Homeowners inherit their
    // own company; staff/admins inherit the target homeowner's company.
    let companyId = session.companyId ?? null;
    if (session.role !== "HOMEOWNER" && assignedHomeownerId) {
      const owner = await prisma.user.findUnique({
        where: { id: assignedHomeownerId },
        select: { companyId: true },
      });
      companyId = owner?.companyId ?? companyId;
    }

    const property = await prisma.property.create({
      data: {
        address,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        areaOfHome: areaOfHome || null,
        coeDate: coeDate ? new Date(coeDate) : null,
        coverageTerm: coverageTerm ? new Date(coverageTerm) : null,
        homeownerId: assignedHomeownerId,
        companyId,
      },
      include: {
        homeowner: {
          select: { name: true, email: true },
        },
      },
    });

    return res.json(property);
  } catch (error) {
    console.error("Create property error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateProperty = async (req, res) => {
  try {
    const { id } = req.params;
    const session = req.user;
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { address, city, state, zipCode, coeDate, areaOfHome, homeownerId, coverageTerm } = req.body;

    const property = await prisma.property.update({
      where: { id },
      data: {
        address,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        areaOfHome: areaOfHome || null,
        coeDate: coeDate ? new Date(coeDate) : null,
        coverageTerm: coverageTerm ? new Date(coverageTerm) : null,
        ...(homeownerId && { homeownerId }),
      },
      include: {
        homeowner: {
          select: { name: true, email: true },
        },
      },
    });

    return res.json(property);
  } catch (error) {
    console.error("Update property error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteProperty = async (req, res) => {
  try {
    const { id } = req.params;
    const session = req.user;
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return res.status(403).json({ message: "Forbidden" });
    }

    await prisma.property.delete({ where: { id } });

    return res.json({ message: "Property deleted" });
  } catch (error) {
    console.error("Delete property error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
