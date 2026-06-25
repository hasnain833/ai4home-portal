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

    let targetCampaignId = id;

    // SW-NUR-007: Sequence Versioning
    // Editing an active sequence creates a new version; existing enrolled leads continue on old version.
    if (campaign.status === "Active") {
      const newVersion = await prisma.campaign.create({
        data: {
          companyId: req.user.companyId,
          name: `${campaign.name} (v2)`,
          description: campaign.description,
          channel: campaign.channel,
          status: "Draft", // Create as draft, user can activate it
        }
      });
      targetCampaignId = newVersion.id;

      await prisma.campaignStep.createMany({
        data: steps.map((step, idx) => ({
          campaignId: targetCampaignId,
          type: step.type,
          position: idx + 1,
          delayValue: step.delayValue !== undefined ? parseInt(step.delayValue, 10) : null,
          delayUnit: step.delayUnit || null,
          sendWindowDays: step.sendWindowDays || null,
          sendWindowStart: step.sendWindowStart || null,
          sendWindowEnd: step.sendWindowEnd || null,
          subject: step.subject || null,
          body: step.body || null,
          templateId: step.templateId || null,
        })),
      });

      const updatedCampaign = await prisma.campaign.findUnique({
        where: { id: targetCampaignId },
        include: { steps: { orderBy: { position: "asc" } } },
      });
      return res.json({ newVersion: true, campaign: updatedCampaign });
    }

    // Delete existing steps and insert new steps in transaction for non-active campaigns
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
          sendWindowDays: step.sendWindowDays || null,
          sendWindowStart: step.sendWindowStart || null,
          sendWindowEnd: step.sendWindowEnd || null,
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
    const skippedDuplicates = [];
    const concurrentWarnings = [];

    for (const leadId of leadIds) {
      try {
        // Verify lead exists and belongs to company
        const lead = await prisma.lead.findFirst({
          where: { id: leadId, companyId: req.user.companyId },
        });

        if (!lead) continue;

        // SW-NUR-002: Prevent duplicate enrollment in the same sequence
        const existingEnrollment = await prisma.campaignEnrollment.findUnique({
          where: { leadId_campaignId: { leadId, campaignId: id } }
        });

        if (existingEnrollment && (existingEnrollment.status === "ACTIVE" || existingEnrollment.status === "PAUSED")) {
          skippedDuplicates.push(leadId);
          continue; // skip duplicate enrollment
        }

        // SW-NUR-002: Warn on concurrent enrollment in multiple sequences
        const concurrentEnrollments = await prisma.campaignEnrollment.findFirst({
          where: { 
            leadId, 
            status: { in: ["ACTIVE", "PAUSED"] },
            campaignId: { not: id }
          }
        });
        if (concurrentEnrollments) {
          concurrentWarnings.push(leadId);
        }

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

    return res.json({ 
      success: true, 
      enrolledCount, 
      skippedDuplicatesCount: skippedDuplicates.length,
      concurrentWarningsCount: concurrentWarnings.length,
      skippedDuplicates,
      concurrentWarnings 
    });
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

export const generateCampaignCopy = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { goal, audience, brandVoice, stepType, contextInfo } = req.body;

    if (!goal || !stepType) {
      return res.status(400).json({ message: "Goal and stepType are required" });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ message: "Anthropic API key is not configured" });
    }

    const systemPrompt = `You are an expert sales copywriter specializing in home builder and warranty care lead nurturing. 
Your task is to write a single ${stepType === 'SMS' ? 'text message' : 'email'} draft.
Keep the tone: ${brandVoice || 'Professional, warm, and helpful'}.
Audience: ${audience || 'Homebuyers or existing homeowners'}.
Goal of this message: ${goal}.

Additional Context: ${contextInfo || 'None'}

Rules:
${stepType === 'SMS' ? '- Keep it under 160 characters if possible.\n- Do NOT include placeholders like [Name]. Use generic but warm greetings.' : '- Provide a concise Subject Line.\n- Provide the Email Body.\n- Do NOT use placeholders like [Lead Name], instead write it so it works universally or use standard greetings.'}
Output your draft clearly.`;

    // Direct fetch to Anthropic API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 500,
        system: systemPrompt,
        messages: [
          { role: "user", content: "Please generate the draft copy based on the provided parameters." }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Anthropic API Error]:", errorText);
      return res.status(500).json({ message: "Failed to generate copy from AI provider" });
    }

    const data = await response.json();
    const content = data.content[0].text;

    return res.json({ success: true, draft: content });
  } catch (error) {
    console.error("[Generate Copy] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
