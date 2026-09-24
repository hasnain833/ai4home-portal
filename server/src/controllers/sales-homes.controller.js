import prisma from "../lib/prisma.js";
import { parseCsv } from "../lib/kb-chunking.js";
import { readSheets, isSpreadsheetFile } from "../lib/spreadsheet.js";
import { assertUploadSafe, buildStorageKey, UploadRejected } from "../lib/file-security.js";
import { BUCKETS, getStorageClient, uploadObject } from "../lib/storage.js";
import {
  SALES_HOME_STATUSES,
  MAX_PHOTOS_PER_HOME,
  isSalesHomeStatus,
  normalizeStatus,
  parseNumber,
  parsePrice,
} from "../lib/sales-homes.js";
import { invalidateSalesSuggestions } from "../services/sales-suggestions.service.js";

const MAX_IMPORT_ROWS = 2000;

const HOME_INCLUDE = {
  community: { select: { id: true, name: true, color: true } },
  photos: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
};

function sendError(res, error, fallback) {
  if (error instanceof UploadRejected) {
    return res.status(error.status).json({ message: error.message, code: error.code });
  }
  console.error(`[Sales Homes] ${fallback}:`, error);
  return res
    .status(error?.status || 500)
    .json({ message: error?.status ? error.message : fallback });
}

function readHomeFields(body = {}, { partial = false } = {}) {
  const data = {};
  const errors = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const text = (v) => {
    const s = v === null || v === undefined ? "" : String(v).trim();
    return s || null;
  };

  if (!partial || has("address")) {
    const address = text(body.address);
    if (!address) errors.push("Address is required");
    else data.address = address;
  }
  for (const k of ["city", "state", "zipCode", "lotNumber", "planName", "moveIn", "description"]) {
    if (!partial || has(k)) data[k] = text(body[k]);
  }
  if (!partial || has("price")) {
    const price = parsePrice(body.price);
    if (text(body.price) && price === null) errors.push("Price must be a number");
    data.price = price;
  }
  for (const k of ["bedrooms", "bathrooms"]) {
    if (!partial || has(k)) data[k] = parseNumber(body[k]);
  }
  if (!partial || has("sqft")) data.sqft = parseNumber(body.sqft, { integer: true });
  if (!partial || has("status")) {
    const status = body.status ? normalizeStatus(body.status) : "AVAILABLE";
    if (!status) errors.push(`Status must be one of: ${SALES_HOME_STATUSES.join(", ")}`);
    else data.status = status;
  }
  return { data, errors };
}

async function assertCommunity(companyId, communityId) {
  if (!communityId) return null;
  return prisma.community.findFirst({ where: { id: communityId, companyId }, select: { id: true } });
}

export const listHomes = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { communityId, status } = req.query;
    const homes = await prisma.salesHome.findMany({
      where: {
        companyId,
        ...(communityId ? { communityId: String(communityId) } : {}),
        ...(status && isSalesHomeStatus(status) ? { status } : {}),
      },
      include: HOME_INCLUDE,
      orderBy: [{ community: { name: "asc" } }, { address: "asc" }],
    });
    return res.json({ homes, statuses: SALES_HOME_STATUSES, maxPhotos: MAX_PHOTOS_PER_HOME });
  } catch (error) {
    return sendError(res, error, "Failed to load homes");
  }
};

export const createHome = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { data, errors } = readHomeFields(req.body);
    if (!(await assertCommunity(companyId, req.body?.communityId))) errors.push("Choose a community");
    if (errors.length) return res.status(400).json({ message: errors[0], errors });

    const home = await prisma.salesHome.create({
      data: { ...data, companyId, communityId: req.body.communityId },
      include: HOME_INCLUDE,
    });
    invalidateSalesSuggestions(companyId);
    return res.status(201).json(home);
  } catch (error) {
    return sendError(res, error, "Failed to create home");
  }
};

export const updateHome = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.salesHome.findFirst({ where: { id: req.params.id, companyId } });
    if (!existing) return res.status(404).json({ message: "Home not found" });

    const { data, errors } = readHomeFields(req.body, { partial: true });
    if (req.body?.communityId !== undefined) {
      if (!(await assertCommunity(companyId, req.body.communityId))) errors.push("Choose a community");
      else data.communityId = req.body.communityId;
    }
    if (errors.length) return res.status(400).json({ message: errors[0], errors });

    const home = await prisma.salesHome.update({
      where: { id: existing.id },
      data,
      include: HOME_INCLUDE,
    });
    invalidateSalesSuggestions(companyId);
    return res.json(home);
  } catch (error) {
    return sendError(res, error, "Failed to update home");
  }
};

async function removePhotoObjects(urls) {
  const marker = `/${BUCKETS.salesHomePhotos}/`;
  const keys = urls
    .map((u) => {
      const at = String(u || "").indexOf(marker);
      return at < 0 ? null : decodeURIComponent(String(u).slice(at + marker.length).split("?")[0]);
    })
    .filter(Boolean);
  if (!keys.length) return;
  try {
    const { error } = await getStorageClient().storage.from(BUCKETS.salesHomePhotos).remove(keys);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn("[Sales Homes] could not remove photo objects:", e.message);
  }
}

export const deleteHome = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const home = await prisma.salesHome.findFirst({
      where: { id: req.params.id, companyId },
      include: { photos: { select: { url: true } } },
    });
    if (!home) return res.status(404).json({ message: "Home not found" });

    await prisma.salesHome.delete({ where: { id: home.id } });
    await removePhotoObjects(home.photos.map((p) => p.url));
    invalidateSalesSuggestions(companyId);
    return res.json({ success: true });
  } catch (error) {
    return sendError(res, error, "Failed to delete home");
  }
};

export const uploadPhotos = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const home = await prisma.salesHome.findFirst({
      where: { id: req.params.id, companyId },
      include: { _count: { select: { photos: true } } },
    });
    if (!home) return res.status(404).json({ message: "Home not found" });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ message: "No photos provided" });
    if (home._count.photos + files.length > MAX_PHOTOS_PER_HOME) {
      return res.status(400).json({
        message: `A home can have up to ${MAX_PHOTOS_PER_HOME} photos. This one has ${home._count.photos}.`,
      });
    }

    for (const file of files) await assertUploadSafe(file, "image");

    let order = home._count.photos;
    for (const file of files) {
      const { publicUrl } = await uploadObject({
        bucket: BUCKETS.salesHomePhotos,
        key: buildStorageKey(`${companyId}/${home.id}`, file.originalname, "photo.jpg"),
        buffer: file.buffer,
        contentType: file.mimetype,
        isPublic: true,
      });
      await prisma.salesHomePhoto.create({ data: { homeId: home.id, url: publicUrl, sortOrder: order++ } });
    }

    const updated = await prisma.salesHome.findUnique({ where: { id: home.id }, include: HOME_INCLUDE });
    return res.status(201).json(updated);
  } catch (error) {
    return sendError(res, error, "Failed to upload photos");
  }
};

export const deletePhoto = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const photo = await prisma.salesHomePhoto.findFirst({
      where: { id: req.params.photoId, homeId: req.params.id, home: { companyId } },
    });
    if (!photo) return res.status(404).json({ message: "Photo not found" });

    await prisma.salesHomePhoto.delete({ where: { id: photo.id } });
    await removePhotoObjects([photo.url]);
    const updated = await prisma.salesHome.findUnique({ where: { id: req.params.id }, include: HOME_INCLUDE });
    return res.json(updated);
  } catch (error) {
    return sendError(res, error, "Failed to delete photo");
  }
};

export const makeCover = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const home = await prisma.salesHome.findFirst({
      where: { id: req.params.id, companyId },
      include: { photos: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true } } },
    });
    if (!home) return res.status(404).json({ message: "Home not found" });
    if (!home.photos.some((p) => p.id === req.params.photoId)) {
      return res.status(404).json({ message: "Photo not found" });
    }

    const ordered = [req.params.photoId, ...home.photos.map((p) => p.id).filter((id) => id !== req.params.photoId)];
    await prisma.$transaction(
      ordered.map((id, i) => prisma.salesHomePhoto.update({ where: { id }, data: { sortOrder: i } })),
    );
    const updated = await prisma.salesHome.findUnique({ where: { id: home.id }, include: HOME_INCLUDE });
    return res.json(updated);
  } catch (error) {
    return sendError(res, error, "Failed to reorder photos");
  }
};

const COLUMN_ALIASES = {
  address: "address", street: "address", streetaddress: "address", homeaddress: "address",
  propertyaddress: "address", address1: "address",
  city: "city",
  state: "state", st: "state",
  zip: "zipCode", zipcode: "zipCode", postalcode: "zipCode", postcode: "zipCode",
  lot: "lotNumber", lotnumber: "lotNumber", lotno: "lotNumber", homesite: "lotNumber",
  plan: "planName", planname: "planName", floorplan: "planName", model: "planName", modelname: "planName",
  price: "price", listprice: "price", baseprice: "price", askingprice: "price", saleprice: "price",
  beds: "bedrooms", bedrooms: "bedrooms", bed: "bedrooms", br: "bedrooms", bd: "bedrooms",
  baths: "bathrooms", bathrooms: "bathrooms", bath: "bathrooms", ba: "bathrooms",
  sqft: "sqft", squarefeet: "sqft", squarefootage: "sqft", sf: "sqft", size: "sqft",
  status: "status", salesstatus: "status", availability: "status",
  movein: "moveIn", moveindate: "moveIn", availabledate: "moveIn", readydate: "moveIn",
  estimatedcompletion: "moveIn", completion: "moveIn",
  description: "description", notes: "description", features: "description",
  community: "community", communityname: "community", neighborhood: "community",
  subdivision: "community", development: "community",
};

const squash = (h) => String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function readTable(file) {
  if (isSpreadsheetFile(file.originalname)) {
    const sheets = readSheets(file.buffer);
    return sheets[0]?.rows || [];
  }
  return parseCsv(file.buffer.toString("utf8"));
}

export const importHomes = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const file = req.file;
    if (!file) return res.status(400).json({ message: "No file provided" });
    if (!/\.(csv|xlsx)$/i.test(file.originalname || "")) {
      return res.status(400).json({ message: "Upload a .csv or .xlsx file" });
    }
    await assertUploadSafe(file, "kbDocument");

    const table = readTable(file).filter((r) => r.some((c) => String(c || "").trim()));
    if (table.length < 2) return res.status(400).json({ message: "The file has no rows under its header" });
    if (table.length - 1 > MAX_IMPORT_ROWS) {
      return res.status(400).json({ message: `Import up to ${MAX_IMPORT_ROWS} homes at a time` });
    }

    const headers = table[0].map((h) => COLUMN_ALIASES[squash(h)] || null);
    if (!headers.includes("address")) {
      return res.status(400).json({ message: "The file needs an Address column" });
    }

    const defaultCommunity = await assertCommunity(companyId, req.body?.communityId);
    if (!headers.includes("community") && !defaultCommunity) {
      return res.status(400).json({
        message: "The file has no Community column — choose a community to import into",
      });
    }

    const communities = await prisma.community.findMany({ where: { companyId }, select: { id: true, name: true } });
    const byName = new Map(communities.map((c) => [c.name.trim().toLowerCase(), c.id]));
    let communitiesCreated = 0;
    const communityIdFor = async (name) => {
      const clean = String(name || "").trim();
      if (!clean) return defaultCommunity?.id || null;
      const hit = byName.get(clean.toLowerCase());
      if (hit) return hit;
      const created = await prisma.community.create({ data: { companyId, name: clean }, select: { id: true } });
      byName.set(clean.toLowerCase(), created.id);
      communitiesCreated++;
      return created.id;
    };

    let created = 0;
    let updated = 0;
    const rowErrors = [];

    for (let i = 1; i < table.length; i++) {
      const raw = {};
      headers.forEach((field, col) => {
        if (field && raw[field] === undefined) raw[field] = table[i][col];
      });

      const { data, errors } = readHomeFields({ ...raw, status: raw.status || "AVAILABLE" });
      const communityId = await communityIdFor(raw.community);
      if (!communityId) errors.push("No community");
      if (errors.length) {
        rowErrors.push({ row: i + 1, message: errors.join("; ") });
        continue;
      }

      const match = await prisma.salesHome.findFirst({
        where: {
          companyId,
          communityId,
          address: { equals: data.address, mode: "insensitive" },
          ...(data.lotNumber ? { lotNumber: data.lotNumber } : {}),
        },
        select: { id: true },
      });

      if (match) {
        const changes = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null));
        await prisma.salesHome.update({ where: { id: match.id }, data: changes });
        updated++;
      } else {
        await prisma.salesHome.create({ data: { ...data, companyId, communityId } });
        created++;
      }
    }

    invalidateSalesSuggestions(companyId);
    return res.json({
      created,
      updated,
      skipped: rowErrors.length,
      communitiesCreated,
      errors: rowErrors.slice(0, 50),
    });
  } catch (error) {
    return sendError(res, error, "Failed to import homes");
  }
};
