import prisma from "../lib/prisma.js";

export const getSalesAgentAppointments = async (req, res) => {
  try {
    // Only SUPER_ADMIN should access this, but auth middleware checks happen at route level
    const appointments = await prisma.salesAgentAppointment.findMany({
      orderBy: { createdAt: "desc" },
    });

    const jobs = await prisma.b2BInquiry.findMany({ where: { id: { in: appointments.filter((a) => a.source === "WEBSITE_SALES").map((a) => a.id) }, type: "BOOKING" }, select: { id: true, adminSentAt: true, visitorSentAt: true, adminSmsSentAt: true, visitorSmsSentAt: true, lastError: true } });
    return res.json(appointments.map((a) => ({ ...a, notifications: jobs.find((j) => j.id === a.id) || null })));
  } catch (error) {
    console.error("[Admin Sales Agent Appointments] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
