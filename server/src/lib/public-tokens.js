import crypto from "crypto";
import prisma from "./prisma.js";

export function createPublicToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export async function getOrCreateLeadBookingToken(leadId) {
  const existing = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { bookingToken: true },
  });
  if (!existing) return null;
  if (existing.bookingToken) return existing.bookingToken;

  for (let attempt = 0; attempt < 3; attempt++) {
    const bookingToken = createPublicToken();
    try {
      const updated = await prisma.lead.update({
        where: { id: leadId },
        data: { bookingToken },
        select: { bookingToken: true },
      });
      return updated.bookingToken;
    } catch (error) {
      if (error?.code !== "P2002") throw error;
    }
  }
  throw new Error("Could not allocate a unique booking token.");
}

export function appointmentTokenData() {
  return {
    rescheduleToken: createPublicToken(),
    cancelToken: createPublicToken(),
  };
}
