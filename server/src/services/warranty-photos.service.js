import prisma from "../lib/prisma.js";
import { assertUploadSafe, buildStorageKey } from "../lib/file-security.js";
import { BUCKETS, uploadObject, resolveDownloadUrl, deleteObject } from "../lib/storage.js";

// Photos of a warranty issue. They are taken during the chat, before any ticket
// exists, so they belong to the conversation first; filing the ticket moves
// them onto it.

export const MAX_PHOTOS_PER_CLAIM = 6;
const SIGNED_URL_TTL = 60 * 60;

export class PhotoLimitReached extends Error {
  constructor(count) {
    super(`You can add up to ${MAX_PHOTOS_PER_CLAIM} photos. This conversation already has ${count}.`);
    this.status = 400;
  }
}

async function sign(rows) {
  return Promise.all(
    rows.map(async (a) => ({
      id: a.id,
      fileName: a.fileName,
      contentType: a.contentType,
      size: a.size,
      createdAt: a.createdAt,
      url: await resolveDownloadUrl(a.url, { expiresIn: SIGNED_URL_TTL }),
    })),
  );
}

export async function countConversationPhotos(conversationId) {
  if (!conversationId) return 0;
  return prisma.ticketAttachment.count({ where: { conversationId, ticketId: null } });
}

export async function listConversationPhotos(conversationId) {
  const rows = await prisma.ticketAttachment.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });
  return sign(rows);
}

export async function listTicketPhotos(ticketId) {
  const rows = await prisma.ticketAttachment.findMany({
    where: { ticketId },
    orderBy: { createdAt: "asc" },
  });
  return sign(rows);
}

/** Validates every file before storing any, so one bad file leaves nothing half-done. */
export async function addConversationPhotos(convo, files) {
  const existing = await prisma.ticketAttachment.count({ where: { conversationId: convo.id } });
  if (existing + files.length > MAX_PHOTOS_PER_CLAIM) throw new PhotoLimitReached(existing);

  for (const file of files) await assertUploadSafe(file, "image");

  for (const file of files) {
    const { ref } = await uploadObject({
      bucket: BUCKETS.warrantyPhotos,
      key: buildStorageKey(`${convo.companyId}/${convo.id}`, file.originalname, "photo.jpg"),
      buffer: file.buffer,
      contentType: file.mimetype,
    });
    await prisma.ticketAttachment.create({
      data: {
        companyId: convo.companyId,
        conversationId: convo.id,
        url: ref,
        fileName: String(file.originalname || "photo.jpg").slice(0, 200),
        contentType: file.mimetype,
        size: file.size,
      },
    });
  }
  return listConversationPhotos(convo.id);
}

/** Only a photo not yet on a ticket can be removed from the chat. */
export async function removeConversationPhoto(convo, photoId) {
  const photo = await prisma.ticketAttachment.findFirst({
    where: { id: photoId, conversationId: convo.id, ticketId: null },
  });
  if (!photo) return false;
  await prisma.ticketAttachment.delete({ where: { id: photo.id } });
  await deleteObject(photo.url);
  return true;
}

export async function attachConversationPhotos(conversationId, ticketId) {
  if (!conversationId || !ticketId) return 0;
  const { count } = await prisma.ticketAttachment.updateMany({
    where: { conversationId, ticketId: null },
    data: { ticketId },
  });
  return count;
}
