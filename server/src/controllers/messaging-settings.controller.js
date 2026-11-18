import prisma from "../lib/prisma.js";
import { MailService } from "../services/mail-service.js";
import { getMessagingCapabilities } from "../lib/messaging-config.js";
import { submitRegistration } from "../services/sms-registration.js";
import { writeAuditLog } from "../lib/audit.js";

/** The builder registers its own texting number (SRS SMS-02). */
export const submitTextingRegistration = async (req, res) => {
  try {
    if (!req.user?.companyId) return res.status(403).json({ message: "No company associated" });
    const { company, status, message } = await submitRegistration(req.user.companyId, req.body);
    if (!company) return res.status(status).json({ message });
    await writeAuditLog({
      req,
      action: "COMPANY_SMS_REGISTRATION_SUBMITTED",
      companyId: company.id,
      targetType: "Company",
      targetId: company.id,
      metadata: { legalName: company.smsRegistration?.legalName, by: "builder" },
    });
    return res.json({ status: company.smsStatus, number: null, rejectReason: null, registration: company.smsRegistration });
  } catch (error) {
    console.error("Error submitting texting registration:", error);
    return res.status(500).json({ message: "Could not submit the registration." });
  }
};

export const getMessagingSettings = async (req, res) => {
  const session = req.user;
  if (!session) return res.status(401).json({ message: "Unauthorized" });

  const companyId = session.companyId;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, email: true, smsNumber: true, smsStatus: true, smsRejectReason: true, smsRegistration: true },
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
    // The builder's own texting number (SRS SMS-05): shown only once approved, status always.
    textingNumber: {
      status: company?.smsStatus || "NONE",
      number: company?.smsStatus === "APPROVED" ? company.smsNumber : null,
      rejectReason: company?.smsStatus === "REJECTED" ? company.smsRejectReason : null,
      registration: company?.smsRegistration || null, // pre-fills a resubmission
    },
    usageThisMonth: usage.map((row) => ({
      channel: row.channel,
      units: row._sum.units || 0,
      costMicros: row._sum.costMicros || 0,
    })),
  });
};

export const getCapabilities = async (req, res) => {
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });
  return res.json(await getMessagingCapabilities());
};
