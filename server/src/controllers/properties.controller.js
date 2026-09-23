import prisma from "../lib/prisma.js";
import { MAX_HOMES_PER_COMMUNITY } from "../lib/communities.js";

const COVERAGE_YEARS = 1;

function coverageTermFor(coeDate) {
  if (!coeDate) return null;
  const coe = new Date(coeDate);
  if (Number.isNaN(coe.getTime())) return null;
  const end = new Date(coe.getTime());
  end.setFullYear(end.getFullYear() + COVERAGE_YEARS);
  return end;
}

function parseUnits(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const COMMUNITY_SELECT = { select: { id: true, name: true, type: true, color: true } };

/**
 * A home belongs to exactly one community, and a community holds at most 50.
 * `excludePropertyId` lets an edit that keeps a property in place not count
 * itself towards the limit.
 */
async function checkCommunity(communityId, companyId, excludePropertyId = null) {
  if (!communityId) return { error: "Please choose a community for this home." };

  const community = await prisma.community.findFirst({
    where: { id: communityId, companyId },
    select: { id: true, name: true },
  });
  if (!community) return { error: "That community does not belong to this company." };

  const homes = await prisma.property.count({
    where: {
      communityId,
      ...(excludePropertyId ? { id: { not: excludePropertyId } } : {}),
    },
  });
  if (homes >= MAX_HOMES_PER_COMMUNITY) {
    return {
      error: `${community.name} is full — a community can hold at most ${MAX_HOMES_PER_COMMUNITY} homes.`,
    };
  }
  return { community };
}

/**
 * One home per homeowner. The database enforces this with a unique index; this
 * check exists so the failure is a sentence rather than a constraint violation.
 */
async function checkHomeownerFree(homeownerId, excludePropertyId = null) {
  const existing = await prisma.property.findFirst({
    where: {
      homeownerId,
      ...(excludePropertyId ? { id: { not: excludePropertyId } } : {}),
    },
    select: { address: true },
  });
  if (existing) {
    return {
      error: `That homeowner already has a home registered (${existing.address}). A homeowner can only have one.`,
    };
  }
  return {};
}

export const getProperties = async (req, res) => {
  try {
    const session = req.user;
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (session.role === "HOMEOWNER") {
      const properties = await prisma.property.findMany({
        where: { homeownerId: session.id },
        include: { community: COMMUNITY_SELECT },
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
          homeowner: { select: { name: true, email: true } },
          community: COMMUNITY_SELECT,
          // Outstanding means not yet resolved: a dispatched ticket still needs
          // watching, so it counts the same as an untouched one.
          _count: {
            select: { tickets: { where: { status: { not: "RESOLVED" } } } },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      // Tickets the warranty agent never tied to a home sit against the owner
      // with propertyId null. The per-home ticket list counts them in, so the
      // badge has to as well or the two disagree.
      const orphans = await prisma.ticket.groupBy({
        by: ["homeownerId"],
        where: {
          propertyId: null,
          status: { not: "RESOLVED" },
          homeowner: { companyId: session.companyId || undefined },
        },
        _count: { _all: true },
      });
      const orphansByHomeowner = new Map(
        orphans.map((o) => [o.homeownerId, o._count._all]),
      );

      return res.json(
        properties.map(({ _count, ...property }) => ({
          ...property,
          openTicketCount:
            (_count?.tickets ?? 0) +
            (orphansByHomeowner.get(property.homeownerId) ?? 0),
        })),
      );
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

    const { address, city, state, zipCode, coeDate, areaOfHome, units, homeownerId, communityId } =
      req.body;

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

    const free = await checkHomeownerFree(assignedHomeownerId);
    if (free.error) return res.status(400).json({ message: free.error });

    const community = await checkCommunity(communityId, companyId);
    if (community.error) return res.status(400).json({ message: community.error });

    const property = await prisma.property.create({
      data: {
        address,
        communityId,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        areaOfHome: areaOfHome || null,
        units: parseUnits(units),
        coeDate: coeDate ? new Date(coeDate) : null,
        coverageTerm: coverageTermFor(coeDate),
        homeownerId: assignedHomeownerId,
        companyId,
      },
      include: {
        homeowner: { select: { name: true, email: true } },
        community: COMMUNITY_SELECT,
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

    const { address, city, state, zipCode, coeDate, areaOfHome, units, homeownerId, communityId } =
      req.body;

    // Scoped by company: without this, any id from another tenant was editable.
    const existing = await prisma.property.findFirst({
      where: { id, homeowner: { companyId: session.companyId } },
      select: { id: true, communityId: true, homeownerId: true, companyId: true },
    });
    if (!existing) {
      return res.status(404).json({ message: "Property not found" });
    }

    if (homeownerId && homeownerId !== existing.homeownerId) {
      const free = await checkHomeownerFree(homeownerId, id);
      if (free.error) return res.status(400).json({ message: free.error });
    }

    if (communityId && communityId !== existing.communityId) {
      const community = await checkCommunity(communityId, existing.companyId ?? session.companyId, id);
      if (community.error) return res.status(400).json({ message: community.error });
    }

    const property = await prisma.property.update({
      where: { id },
      data: {
        address,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        areaOfHome: areaOfHome || null,
        units: parseUnits(units),
        coeDate: coeDate ? new Date(coeDate) : null,
        coverageTerm: coverageTermFor(coeDate),
        ...(homeownerId && { homeownerId }),
        ...(communityId && { communityId }),
      },
      include: {
        homeowner: { select: { name: true, email: true } },
        community: COMMUNITY_SELECT,
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

    const existing = await prisma.property.findFirst({
      where: { id, homeowner: { companyId: session.companyId } },
      select: { id: true },
    });
    if (!existing) {
      return res.status(404).json({ message: "Property not found" });
    }

    await prisma.property.delete({ where: { id } });

    return res.json({ message: "Property deleted" });
  } catch (error) {
    console.error("Delete property error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Bulk-register homes from a CSV the page has already parsed into rows.
 *
 * Deliberately synchronous, unlike the leads importer: a community holds at
 * most 50 homes, so a realistic file is tens of rows, not tens of thousands.
 *
 * Every rule that applies to a single home applies here too — one home per
 * homeowner, and 50 per community — but counted across the whole batch, so a
 * 60-row file cannot slip past a 50-home cap one row at a time.
 *
 * Expected columns: address, city, state, zipCode, coeDate, units,
 * homeownerEmail, community (name). Rows are validated as a set and nothing is
 * written unless every row passes, so a part-imported file never happens.
 */
export const importProperties = async (req, res) => {
  try {
    const session = req.user;
    if (!session || (session.role !== "ADMIN" && session.role !== "STAFF")) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "No rows to import." });
    }
    if (rows.length > 500) {
      return res.status(400).json({ message: "Please import at most 500 rows at a time." });
    }

    const companyId = session.companyId;

    const [homeowners, communities] = await Promise.all([
      prisma.user.findMany({
        where: { companyId, role: "HOMEOWNER" },
        select: { id: true, email: true, properties: { select: { id: true } } },
      }),
      prisma.community.findMany({
        where: { companyId },
        select: { id: true, name: true, _count: { select: { properties: true } } },
      }),
    ]);

    const ownerByEmail = new Map(homeowners.map((h) => [h.email.toLowerCase(), h]));
    const communityByName = new Map(communities.map((c) => [c.name.toLowerCase(), c]));

    // Seeded from what is already stored, then incremented as the batch is
    // walked, so the file is judged against the end state rather than the start.
    const roomLeft = new Map(
      communities.map((c) => [c.id, MAX_HOMES_PER_COMMUNITY - c._count.properties]),
    );
    const claimedOwners = new Set();

    const errors = [];
    const prepared = [];

    rows.forEach((row, index) => {
      const line = index + 2; // +1 for zero-index, +1 for the header row
      const address = String(row.address || "").trim();
      const email = String(row.homeownerEmail || "").trim().toLowerCase();
      const communityName = String(row.community || "").trim();

      if (!address) {
        errors.push({ line, message: "Address is required." });
        return;
      }
      if (!email) {
        errors.push({ line, message: "A homeowner email is required." });
        return;
      }

      const owner = ownerByEmail.get(email);
      if (!owner) {
        errors.push({ line, message: `No homeowner in this company with the email ${email}.` });
        return;
      }
      if (owner.properties.length > 0) {
        errors.push({ line, message: `${email} already has a home registered.` });
        return;
      }
      if (claimedOwners.has(owner.id)) {
        errors.push({ line, message: `${email} appears more than once in this file.` });
        return;
      }

      if (!communityName) {
        errors.push({ line, message: "A community is required." });
        return;
      }
      const community = communityByName.get(communityName.toLowerCase());
      if (!community) {
        errors.push({ line, message: `No community named "${communityName}".` });
        return;
      }
      if ((roomLeft.get(community.id) ?? 0) <= 0) {
        errors.push({
          line,
          message: `${community.name} would go over ${MAX_HOMES_PER_COMMUNITY} homes.`,
        });
        return;
      }

      claimedOwners.add(owner.id);
      roomLeft.set(community.id, roomLeft.get(community.id) - 1);

      const coeDate = row.coeDate ? new Date(row.coeDate) : null;
      prepared.push({
        address,
        city: String(row.city || "").trim() || null,
        state: String(row.state || "").trim() || null,
        zipCode: String(row.zipCode || "").trim() || null,
        units: parseUnits(row.units),
        coeDate: coeDate && !Number.isNaN(coeDate.getTime()) ? coeDate : null,
        coverageTerm: coverageTermFor(row.coeDate),
        homeownerId: owner.id,
        communityId: community.id,
        companyId,
      });
    });

    // All or nothing: a half-imported file leaves staff guessing which homes
    // landed, and the rules above were judged against the whole batch anyway.
    if (errors.length > 0) {
      return res.status(400).json({
        message: `${errors.length} row${errors.length === 1 ? "" : "s"} could not be imported. Nothing was saved.`,
        errors: errors.slice(0, 50),
        totalRows: rows.length,
      });
    }

    const created = await prisma.property.createMany({ data: prepared });

    return res.json({ created: created.count, totalRows: rows.length });
  } catch (error) {
    console.error("Import properties error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
