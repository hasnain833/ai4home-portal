import prisma from "../lib/prisma.js";

export const getSegments = async (req, res) => {
  const segments = await prisma.leadSegment.findMany({
    where: { companyId: req.user.companyId },
    orderBy: { createdAt: "desc" },
  });

  return res.json(segments);
};

export const createSegment = async (req, res) => {
  const { name, filters } = req.body;
  if (!name || !filters) {
    return res.status(400).json({ message: "Name and filters are required" });
  }

  const segment = await prisma.leadSegment.create({
    data: {
      companyId: req.user.companyId,
      name,
      filters,
    },
  });

  return res.json(segment);
};

export const deleteSegment = async (req, res) => {
  const { id } = req.params;

  const segment = await prisma.leadSegment.findUnique({ where: { id } });
  if (!segment || segment.companyId !== req.user.companyId) {
    return res.status(404).json({ message: "Segment not found" });
  }

  await prisma.leadSegment.delete({ where: { id } });

  return res.json({ message: "Segment deleted successfully" });
};

// Evaluate dynamic segment size
export const evaluateSegment = async (req, res) => {
  const { id } = req.params;

  const segment = await prisma.leadSegment.findUnique({ where: { id } });
  if (!segment || segment.companyId !== req.user.companyId) {
    return res.status(404).json({ message: "Segment not found" });
  }

  const whereClause = buildPrismaWhereClause(segment.filters, req.user.companyId);

  const count = await prisma.lead.count({ where: whereClause });

  return res.json({ count });
};

export function buildPrismaWhereClause(filters, companyId) {
  const where = { companyId };
  if (!filters || !Array.isArray(filters)) return where;

  const andConditions = [];

  for (const filter of filters) {
    const { field, operator, value } = filter;
    let condition = {};
    if (operator === "equals") condition = { equals: value };
    else if (operator === "contains") condition = { contains: value, mode: "insensitive" };
    else if (operator === "startsWith") condition = { startsWith: value, mode: "insensitive" };
    else if (operator === "in") condition = { in: Array.isArray(value) ? value : [value] };
    else if (operator === "true") condition = true;
    else if (operator === "false") condition = false;

    if (field === "tags" && operator === "contains") {
        andConditions.push({ tags: { has: value } });
    } else {
        andConditions.push({ [field]: condition });
    }
  }

  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  return where;
}
