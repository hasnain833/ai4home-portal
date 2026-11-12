import prisma from "../lib/prisma.js";

export const getUsers = async (req, res) => {
  const session = req.user;

  const roleParam = req.query.role;

  const users = await prisma.user.findMany({
    where: {
      companyId: session.companyId,
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
};
