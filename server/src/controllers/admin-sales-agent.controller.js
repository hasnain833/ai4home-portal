import prisma from "../lib/prisma.js";

export const getSalesAgentAppointments = async (req, res) => {
  try {
    // Only SUPER_ADMIN should access this, but auth middleware checks happen at route level
    const appointments = await prisma.salesAgentAppointment.findMany({
      orderBy: { createdAt: "desc" },
    });

    return res.json(appointments);
  } catch (error) {
    console.error("[Admin Sales Agent Appointments] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
