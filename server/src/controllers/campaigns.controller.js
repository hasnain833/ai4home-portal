import prisma from "../lib/prisma.js";

export const getCampaigns = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const companyId = req.user.companyId;
    const campaigns = await prisma.campaign.findMany({
      where: { companyId },
      include: {
        _count: {
          select: {
            steps: true,
          },
        },
        enrollments: {
          select: { status: true, exitedReason: true }
        }
      },
      orderBy: { createdAt: "desc" },
    });

    // Format metrics matches frontend format
    const formatted = campaigns.map((seq) => {
      const totalLeads = seq.enrollments.length;
      const convertedLeads = seq.enrollments.filter(e => 
        e.status === "EXITED" && (e.exitedReason === "REPLY" || e.exitedReason === "APPOINTMENT")
      ).length;
      
      const conversionRate = totalLeads > 0 
        ? ((convertedLeads / totalLeads) * 100).toFixed(1) + "%" 
        : "0.0%";

      return {
        id: seq.id,
        name: seq.name,
        description: seq.description,
        status: seq.status,
        channel: seq.channel,
        stepsCount: seq._count.steps,
        totalLeads: totalLeads,
        conversionRate: conversionRate,
        conversionCount: convertedLeads,
      };
    });

    return res.json(formatted);
  } catch (error) {
    console.error("[Campaigns List] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getCampaignDetail = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { id } = req.params;
    const campaign = await prisma.campaign.findFirst({
      where: { id, companyId: req.user.companyId },
      include: {
        steps: {
          orderBy: { position: "asc" },
        },
        enrollments: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: "Campaign not found" });
    }

    return res.json(campaign);
  } catch (error) {
    console.error("[Campaign Detail] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createCampaign = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { name, description, channel } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Campaign name is required" });
    }

    const campaign = await prisma.campaign.create({
      data: {
        companyId: req.user.companyId,
        name,
        description: description || null,
        channel: channel || "Email & SMS",
        status: "Draft",
      },
    });

    return res.status(201).json(campaign);
  } catch (error) {
    console.error("[Campaign Create] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateCampaign = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { id } = req.params;
    const { name, description, channel, status } = req.body;

    const campaign = await prisma.campaign.findFirst({
      where: { id, companyId: req.user.companyId },
    });

    if (!campaign) {
      return res.status(404).json({ message: "Campaign not found" });
    }

    const updated = await prisma.campaign.update({
      where: { id },
      data: {
        name: name || campaign.name,
        description: description !== undefined ? description : campaign.description,
        channel: channel || campaign.channel,
        status: status || campaign.status,
      },
    });

    if (status === "Active" && req.body.relaunch) {
      await prisma.campaignEnrollment.updateMany({
        where: { campaignId: id },
        data: {
          status: "ACTIVE",
          currentStepPosition: 0,
          nextRunAt: new Date(),
          exitedReason: null
        }
      });
    }

    return res.json(updated);
  } catch (error) {
    console.error("[Campaign Update] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateCampaignSteps = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { id } = req.params;
    const { steps } = req.body;

    if (!Array.isArray(steps)) {
      return res.status(400).json({ message: "Steps must be an array" });
    }

    // Verify campaign ownership
    const campaign = await prisma.campaign.findFirst({
      where: { id, companyId: req.user.companyId },
    });

    if (!campaign) {
      return res.status(404).json({ message: "Campaign not found" });
    }

    const finalStatus = (campaign.status === "Draft" || campaign.status === "Ready") 
      ? (steps.length > 0 ? "Ready" : "Draft") 
      : campaign.status;

    // Delete existing steps and insert new steps in transaction
    await prisma.$transaction([
      prisma.campaign.update({
        where: { id },
        data: { status: finalStatus }
      }),
      prisma.campaignStep.deleteMany({ where: { campaignId: id } }),
      prisma.campaignStep.createMany({
        data: steps.map((step, idx) => ({
          campaignId: id,
          type: step.type, // "EMAIL", "SMS", "DELAY"
          position: idx + 1,
          delayValue: step.delayValue !== undefined ? parseInt(step.delayValue, 10) : null,
          delayUnit: step.delayUnit || null, // "MINUTES", "HOURS", "DAYS"
          subject: step.subject || null,
          body: step.body || null,
          templateId: step.templateId || null,
        })),
      }),
    ]);

    const updatedCampaign = await prisma.campaign.findUnique({
      where: { id },
      include: { steps: { orderBy: { position: "asc" } } },
    });

    return res.json(updatedCampaign);
  } catch (error) {
    console.error("[Campaign Steps Update] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const enrollCampaign = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { id } = req.params;
    const { leadIds } = req.body;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ message: "leadIds array is required" });
    }

    const campaign = await prisma.campaign.findFirst({
      where: { id, companyId: req.user.companyId },
    });

    if (!campaign) {
      return res.status(404).json({ message: "Campaign not found" });
    }

    // Fetch the first campaign step to inspect if it starts with a DELAY
    const firstStep = await prisma.campaignStep.findFirst({
      where: { campaignId: id },
      orderBy: { position: "asc" },
    });

    let enrolledCount = 0;

    for (const leadId of leadIds) {
      try {
        // Verify lead exists and belongs to company
        const lead = await prisma.lead.findFirst({
          where: { id: leadId, companyId: req.user.companyId },
        });

        if (!lead) continue;

        let initialStepPosition = 0;
        let nextRunAt = new Date();

        if (firstStep && firstStep.type === "DELAY") {
          initialStepPosition = 1;
          const value = firstStep.delayValue || 0;
          const unit = (firstStep.delayUnit || "DAYS").toUpperCase();
          if (unit === "MINUTES" || unit === "MINUTE") {
            nextRunAt.setMinutes(nextRunAt.getMinutes() + value);
          } else if (unit === "HOURS" || unit === "HOUR") {
            nextRunAt.setHours(nextRunAt.getHours() + value);
          } else {
            nextRunAt.setDate(nextRunAt.getDate() + value);
          }
        }

        // Upsert enrollment to start at step 0 immediately (or step 1 if delayed)
        await prisma.campaignEnrollment.upsert({
          where: {
            leadId_campaignId: {
              leadId,
              campaignId: id,
            },
          },
          create: {
            leadId,
            campaignId: id,
            status: "ACTIVE",
            currentStepPosition: initialStepPosition,
            nextRunAt,
          },
          update: {
            status: "ACTIVE",
            currentStepPosition: initialStepPosition,
            nextRunAt,
            exitedReason: null,
          },
        });

        // Add timeline record
        await prisma.leadTimeline.create({
          data: {
            leadId,
            type: "SYNC_UPDATE",
            description: `Enrolled in nurture campaign "${campaign.name}"`,
          },
        });

        enrolledCount++;
      } catch (err) {
        console.error(`Failed to enroll lead ${leadId}:`, err);
      }
    }

    return res.json({ success: true, enrolledCount });
  } catch (error) {
    console.error("[Campaign Enroll] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteCampaign = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { id } = req.params;

    const campaign = await prisma.campaign.findFirst({
      where: { id, companyId: req.user.companyId },
    });

    if (!campaign) {
      return res.status(404).json({ message: "Campaign not found" });
    }

    await prisma.campaign.delete({ where: { id } });

    return res.json({ success: true, message: "Campaign deleted successfully" });
  } catch (error) {
    console.error("[Campaign Delete] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
