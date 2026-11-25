// Legacy: AI4Home's own meetings were booked through a platform Calendly from 2026-11-10 to 2026-11-24.
// Super Admin now books on its own hours; this pointer only lets those old meetings (calendlyEventUri set)
// be cancelled in Calendly and keep their Calendly join link. Trades keep their own Calendly.
import prisma from "./prisma.js";

export async function platformCalendlyPointer() {
  return (await prisma.platformSetting.findUnique({ where: { key: "platform.calendly" } }))?.value || null;
}
