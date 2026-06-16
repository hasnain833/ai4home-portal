import prisma from "../lib/prisma.js";

export const getSequences = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const companyId = req.user.companyId;
    const sequences = await prisma.sequence.findMany({
      where: { companyId },
      include: {
        _count: {
          select: {
            steps: true,
            enrollments: { where: { status: "ACTIVE" } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Format metrics matches frontend format
    const formatted = sequences.map((seq) => ({
      id: seq.id,
      name: seq.name,
      description: seq.description,
      status: seq.status,
      channel: seq.channel,
      stepsCount: seq._count.steps,
      activeLeads: seq._count.enrollments,
      conversionRate: "0.0%",
      conversionCount: 0,
    }));

    return res.json(formatted);
  } catch (error) {
    console.error("[Sequences List] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getSequenceDetail = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { id } = req.params;
    const sequence = await prisma.sequence.findFirst({
      where: { id, companyId: req.user.companyId },
      include: {
        steps: {
          orderBy: { position: "asc" },
        },
      },
    });

    if (!sequence) {
      return res.status(404).json({ message: "Sequence not found" });
    }

    return res.json(sequence);
  } catch (error) {
    console.error("[Sequence Detail] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createSequence = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { name, description, channel } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Sequence name is required" });
    }

    const sequence = await prisma.sequence.create({
      data: {
        companyId: req.user.companyId,
        name,
        description: description || null,
        channel: channel || "Email & SMS",
        status: "Draft",
      },
    });

    return res.status(201).json(sequence);
  } catch (error) {
    console.error("[Sequence Create] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateSequence = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { id } = req.params;
    const { name, description, channel, status } = req.body;

    const sequence = await prisma.sequence.findFirst({
      where: { id, companyId: req.user.companyId },
    });

    if (!sequence) {
      return res.status(404).json({ message: "Sequence not found" });
    }

    const updated = await prisma.sequence.update({
      where: { id },
      data: {
        name: name || sequence.name,
        description: description !== undefined ? description : sequence.description,
        channel: channel || sequence.channel,
        status: status || sequence.status,
      },
    });

    return res.json(updated);
  } catch (error) {
    console.error("[Sequence Update] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateSequenceSteps = async (req, res) => {
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
    const sequence = await prisma.sequence.findFirst({
      where: { id, companyId: req.user.companyId },
    });

    if (!sequence) {
      return res.status(404).json({ message: "Sequence not found" });
    }

    // Delete existing steps and insert new steps in transaction
    await prisma.$transaction([
      prisma.sequenceStep.deleteMany({ where: { sequenceId: id } }),
      prisma.sequenceStep.createMany({
        data: steps.map((step, idx) => ({
          sequenceId: id,
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

    const updatedSequence = await prisma.sequence.findUnique({
      where: { id },
      include: { steps: { orderBy: { position: "asc" } } },
    });

    return res.json(updatedSequence);
  } catch (error) {
    console.error("[Sequence Steps Update] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const enrollSequence = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { id } = req.params;
    const { leadIds } = req.body;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ message: "leadIds array is required" });
    }

    const sequence = await prisma.sequence.findFirst({
      where: { id, companyId: req.user.companyId },
    });

    if (!sequence) {
      return res.status(404).json({ message: "Sequence not found" });
    }

    let enrolledCount = 0;

    for (const leadId of leadIds) {
      try {
        // Verify lead exists and belongs to company
        const lead = await prisma.lead.findFirst({
          where: { id: leadId, companyId: req.user.companyId },
        });

        if (!lead) continue;

        // Upsert enrollment to start at step 0 immediately
        await prisma.sequenceEnrollment.upsert({
          where: {
            leadId_sequenceId: {
              leadId,
              sequenceId: id,
            },
          },
          create: {
            leadId,
            sequenceId: id,
            status: "ACTIVE",
            currentStepPosition: 0,
            nextRunAt: new Date(), // run first step immediately
          },
          update: {
            status: "ACTIVE",
            currentStepPosition: 0,
            nextRunAt: new Date(),
            exitedReason: null,
          },
        });

        // Add timeline record
        await prisma.leadTimeline.create({
          data: {
            leadId,
            type: "SYNC_UPDATE",
            description: `Enrolled in nurture sequence "${sequence.name}"`,
          },
        });

        enrolledCount++;
      } catch (err) {
        console.error(`Failed to enroll lead ${leadId}:`, err);
      }
    }

    return res.json({ success: true, enrolledCount });
  } catch (error) {
    console.error("[Sequence Enroll] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteSequence = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { id } = req.params;

    const sequence = await prisma.sequence.findFirst({
      where: { id, companyId: req.user.companyId },
    });

    if (!sequence) {
      return res.status(404).json({ message: "Sequence not found" });
    }

    await prisma.sequence.delete({ where: { id } });

    return res.json({ success: true, message: "Sequence deleted successfully" });
  } catch (error) {
    console.error("[Sequence Delete] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
