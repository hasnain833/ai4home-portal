import prisma from "../lib/prisma.js";

export const getUsers = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const roleParam = req.query.role;

    const users = await prisma.user.findMany({
      where: {
        companyId: session.companyId || "demo-company",
        role: roleParam === "homeowner" ? "HOMEOWNER" : undefined,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
      orderBy: { name: "asc" },
    });

    return res.json(users);
  } catch (error) {
    console.error("Fetch users error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
