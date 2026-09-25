import prisma from "../lib/prisma.js";
import { MailService } from "../services/mail-service.js";
import { getMessagingCapabilities } from "../lib/messaging-config.js";

export const getMessagingSettings = async (req, res) => {
  try {
    const session = req.user;
    if (!session) return res.status(401).json({ message: "Unauthorized" });

    const companyId = session.companyId || "demo-company";

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, email: true },
    });

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const usage = await prisma.messageUsage.groupBy({
      by: ["channel"],
      where: { companyId, createdAt: { gte: monthStart } },
      _sum: { units: true, costMicros: true },
    });

    return res.json({
      companyId,
      sender: {
        name: company?.name || null,
        replyTo: process.env.INBOUND_EMAIL_DOMAIN
          ? `reply+${companyId}@${process.env.INBOUND_EMAIL_DOMAIN.trim()}`
          : company?.email || null,
        sendingAddress: MailService.SENDER_EMAIL,
      },
      usageThisMonth: usage.map((row) => ({
        channel: row.channel,
        units: row._sum.units || 0,
        costMicros: row._sum.costMicros || 0,
      })),
    });
  } catch (error) {
    console.error("[MessagingSettings] GET failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getCapabilities = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    return res.json(await getMessagingCapabilities());
  } catch (error) {
    console.error("[MessagingSettings] Capabilities failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
