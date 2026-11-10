import prisma from "./prisma.js";

// Platform OAuth belongs to the platform, including when the admin is an
// environment login with no User row. Tokens are encrypted by the service.
export const PLATFORM_CALENDLY_OWNER = "platform-calendly";
const PLATFORM_CONNECTION_KEY = "platform.calendly.connection";

export async function findCalendlyConnection(userId) {
  if (userId !== PLATFORM_CALENDLY_OWNER) {
    return prisma.calendlyConnection.findUnique({ where: { userId } });
  }
  const value = (await prisma.platformSetting.findUnique({ where: { key: PLATFORM_CONNECTION_KEY } }))?.value;
  if (!value) return null;
  return { ...value, expiresAt: new Date(value.expiresAt), createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) };
}

export async function saveCalendlyConnection(userId, data, { create = false } = {}) {
  if (userId !== PLATFORM_CALENDLY_OWNER) {
    return create
      ? prisma.calendlyConnection.upsert({ where: { userId }, create: { userId, ...data }, update: data })
      : prisma.calendlyConnection.update({ where: { userId }, data });
  }
  const previous = await findCalendlyConnection(userId);
  if (!previous && !create) throw new Error("Connect platform Calendly first.");
  const now = new Date();
  const value = JSON.parse(JSON.stringify({
    id: PLATFORM_CALENDLY_OWNER, userId, createdAt: now,
    eventTypeUri: null, eventTypeName: null, eventDuration: null,
    eventLocationKind: null, webhookUri: null,
    ...previous, ...data, updatedAt: now,
  }));
  await prisma.platformSetting.upsert({ where: { key: PLATFORM_CONNECTION_KEY }, create: { key: PLATFORM_CONNECTION_KEY, value }, update: { value } });
  return { ...value, expiresAt: new Date(value.expiresAt), createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) };
}

export async function deleteCalendlyConnection(userId) {
  if (userId !== PLATFORM_CALENDLY_OWNER) return prisma.calendlyConnection.delete({ where: { userId } });
  return prisma.platformSetting.deleteMany({ where: { key: PLATFORM_CONNECTION_KEY } });
}
