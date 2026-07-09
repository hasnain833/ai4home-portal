import prisma from "../lib/prisma.js";
import { buildPrismaWhereClause } from "./segments.controller.js";
import { chat, hasLLM } from "../lib/llm.js";

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

    const enrollments = campaign.enrollments;
    const analytics = {
      enrolled: enrollments.length,
      active: enrollments.filter((e) => e.status === "ACTIVE" || e.status === "PAUSED").length,
      completed: enrollments.filter((e) => e.status === "COMPLETED").length,
      exited: enrollments.filter((e) => e.status === "EXITED").length,
      exitedByReason: {
        REPLY: enrollments.filter((e) => e.status === "EXITED" && e.exitedReason === "REPLY").length,
        APPOINTMENT: enrollments.filter((e) => e.status === "EXITED" && e.exitedReason === "APPOINTMENT").length,
        UNSUBSCRIBE: enrollments.filter((e) => e.status === "EXITED" && e.exitedReason === "UNSUBSCRIBE").length,
        SUPPRESSED: enrollments.filter((e) => e.status === "EXITED" && e.exitedReason === "SUPPRESSED").length,
      },
    };

    const stepAnalytics = {};
    for (const step of campaign.steps) {
      stepAnalytics[step.id] = {
        sent: 0,
        delivered: 0,
        opened: step.openedCount || 0,
        clicked: step.clickedCount || 0,
        replied: step.repliedCount || 0,
        bounced: 0,
        unsubscribed: 0
      };
    }

    const timelineEvents = await prisma.leadTimeline.findMany({
      where: {
        leadId: { in: enrollments.map((e) => e.leadId) },
        type: { in: ["EMAIL_SENT", "SMS_SENT", "SMS_FAILED"] }
      }
    });

    timelineEvents.forEach((event) => {
      const stepPos = event.metadata?.stepPosition;
      const step = campaign.steps.find(s => s.position === stepPos);
      if (step) {
        if (event.type === "EMAIL_SENT" || event.type === "SMS_SENT") {
          stepAnalytics[step.id].sent++;
          stepAnalytics[step.id].delivered++;
        }
        if (event.type === "SMS_FAILED") {
          stepAnalytics[step.id].bounced++;
        }
      }
    });

    return res.json({
      ...campaign,
      analytics,
      stepAnalytics
    });
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
    const { name, description, channel, status, exitConditions, versionPolicy } = req.body;

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
        exitConditions: exitConditions !== undefined ? exitConditions : campaign.exitConditions,
        versionPolicy: versionPolicy !== undefined ? versionPolicy : campaign.versionPolicy,
      },
    });

    const isLaunching = campaign.status !== "Active" && status === "Active";

    if (isLaunching) {
      const enrollments = await prisma.campaignEnrollment.findMany({
        where: {
          campaignId: id,
          status: "ACTIVE",
        },
      });

      if (enrollments.length > 0) {
        const { inngest } = await import("../lib/inngest.js");
        console.log(`[Campaign Controller] Campaign ${id} launch: sending Inngest events for ${enrollments.length} enrolled leads.`);
        const events = enrollments.map((enrollment) => ({
          name: "campaign.enrollment.started",
          data: {
            leadId: enrollment.leadId,
            campaignId: id,
            enrollmentId: enrollment.id,
          },
        }));
        await inngest.send(events);
        console.log(`[Campaign Controller] Sent ${events.length} Inngest events successfully.`);
      } else {
        console.log(`[Campaign Controller] Campaign ${id} launch: no active enrollments found to trigger.`);
      }
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

    const campaign = await prisma.campaign.findFirst({
      where: { id, companyId: req.user.companyId },
    });

    if (!campaign) {
      return res.status(404).json({ message: "Campaign not found" });
    }

    if (steps.length > 50) {
      return res.status(400).json({ message: "A sequence can have at most 50 steps." });
    }

    const finalStatus = (campaign.status === "Draft" || campaign.status === "Ready")
      ? (steps.length > 0 ? "Ready" : "Draft")
      : campaign.status;

    let targetCampaignId = id;

    if (campaign.status === "Active" && (campaign.versionPolicy || "FINISH_OLD") === "FINISH_OLD") {
      const newVersion = await prisma.campaign.create({
        data: {
          companyId: req.user.companyId,
          name: `${campaign.name} (v2)`,
          description: campaign.description,
          channel: campaign.channel,
          status: "Draft",
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

    await prisma.$transaction([
      prisma.campaign.update({
        where: { id },
        data: { status: finalStatus }
      }),
      prisma.campaignStep.deleteMany({ where: { campaignId: id } }),
      prisma.campaignStep.createMany({
        data: steps.map((step, idx) => ({
          campaignId: id,
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
    const { inngest } = await import("../lib/inngest.js");

    const { id } = req.params;
    let { leadIds } = req.body;
    const { segmentId } = req.body;

    if (segmentId) {
      const segment = await prisma.leadSegment.findFirst({
        where: { id: segmentId, companyId: req.user.companyId },
      });
      if (!segment) {
        return res.status(404).json({ message: "Segment not found" });
      }
      const where = buildPrismaWhereClause(segment.filters, req.user.companyId);
      const segLeads = await prisma.lead.findMany({ where, select: { id: true } });
      leadIds = segLeads.map((l) => l.id);
    }

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ message: "Provide a non-empty leadIds array or a segmentId that matches leads." });
    }

    const campaign = await prisma.campaign.findFirst({
      where: { id, companyId: req.user.companyId },
    });

    if (!campaign) {
      return res.status(404).json({ message: "Campaign not found" });
    }

    const firstStep = await prisma.campaignStep.findFirst({
      where: { campaignId: id },
      orderBy: { position: "asc" },
    });

    let enrolledCount = 0;
    const skippedDuplicates = [];
    const concurrentWarnings = [];

    for (const leadId of leadIds) {
      try {
        const lead = await prisma.lead.findFirst({
          where: { id: leadId, companyId: req.user.companyId },
        });

        if (!lead) continue;

        const existingEnrollment = await prisma.campaignEnrollment.findUnique({
          where: { leadId_campaignId: { leadId, campaignId: id } }
        });

        if (existingEnrollment && (existingEnrollment.status === "ACTIVE" || existingEnrollment.status === "PAUSED")) {
          skippedDuplicates.push(leadId);
          continue;
        }
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
        const enrollment = await prisma.campaignEnrollment.upsert({
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
            currentStepPosition: 1,
          },
          update: {
            status: "ACTIVE",
            currentStepPosition: 1,
            exitedReason: null,
          },
        });
        if (campaign.status === "Active") {
          console.log(`[Campaign Controller] Sending Inngest event 'campaign.enrollment.started' for lead: ${leadId}`);
          await inngest.send({
            name: "campaign.enrollment.started",
            data: {
              leadId,
              campaignId: id,
              enrollmentId: enrollment.id,
            },
          });
          console.log(`[Campaign Controller] Inngest event sent successfully!`);
        } else {
          console.log(`[Campaign Controller] Campaign ${id} is not Active (status: ${campaign.status}). Postponing Inngest event for lead: ${leadId}`);
        }
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

export const unenrollCampaign = async (req, res) => {
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

    const result = await prisma.campaignEnrollment.updateMany({
      where: { campaignId: id, leadId: { in: leadIds }, status: { in: ["ACTIVE", "PAUSED"] } },
      data: { status: "EXITED", exitedReason: "MANUAL" },
    });

    for (const leadId of leadIds) {
      await prisma.leadTimeline.create({
        data: {
          leadId,
          type: "SYNC_UPDATE",
          description: `Manually removed from campaign "${campaign.name}".`,
          metadata: { campaignId: id },
        },
      });
    }

    const activeCount = await prisma.campaignEnrollment.count({
      where: { campaignId: id, status: { in: ["ACTIVE", "PAUSED"] } },
    });
    if (activeCount === 0 && campaign.status === "Active") {
      await prisma.campaign.update({ where: { id }, data: { status: "Completed" } });
    }

    return res.json({ success: true, removed: result.count });
  } catch (error) {
    console.error("[Campaign Unenroll] Error:", error);
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

// --- Create a nurture campaign from a scraped news item (SW-NUR-001/005) ---

function parseJsonBlock(text) {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Strip a trailing " - Source Name" / " — Source" suffix the scraper appends to
// headlines, so it doesn't read awkwardly inside marketing copy.
function cleanNewsTitle(title = "") {
  const cleaned = title.replace(/\s+[-–—]\s+[^-–—]+$/, "").trim();
  return cleaned || title.trim();
}

// A normalized fingerprint used to detect when the summary just repeats the title.
function fingerprint(s = "") {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 50);
}

function buildFallbackNewsCopy(news) {
  const title = cleanNewsTitle(news.title || "");
  const summary = (news.summary || "").trim();
  // Only include the summary if it actually adds detail beyond the headline —
  // otherwise the email showed the same sentence twice.
  const summaryAddsDetail = summary && fingerprint(summary) !== fingerprint(title);
  const insight = summaryAddsDetail
    ? summary
    : "Market conditions are shifting, and it may be a smart moment to revisit your home-buying or selling plans.";

  const emailSubject = `Housing market update: ${title}`.slice(0, 120);
  const emailBody = `Hi {firstName},

Here's a quick housing-market update from the {companyName} team that may affect your plans:

${title}.

${insight}

If you'd like to talk through what this means for you, we're happy to help — book a time that works for you here: {bookingLink}

Warm regards,
The {companyName} Team`;
  const smsBody = `Hi {firstName}, a quick housing update from {companyName}: ${title.slice(0, 90)}. Want to chat about your options? {bookingLink} Reply STOP to opt out.`.slice(0, 320);
  return { emailSubject, emailBody, smsBody };
}

async function generateNewsCampaignCopy(news, company) {
  const fallback = buildFallbackNewsCopy(news);

  if (!hasLLM()) {
    return { ...fallback, aiGenerated: false };
  }

  try {
    const bp = company?.salesBrandProfile || {};
    const brandLines = [
      company?.name ? `Company/builder name: ${company.name}` : null,
      bp.tone || company?.voiceProfile ? `Tone/voice: ${bp.tone || company?.voiceProfile}` : null,
      bp.markets || bp.communities ? `Markets/communities: ${bp.markets || bp.communities}` : null,
      bp.signature ? `Signature/sign-off: ${bp.signature}` : null,
    ].filter(Boolean).join("\n");

    const systemPrompt = `You are an expert real-estate and home-builder marketing copywriter.
Write a lead-nurture EMAIL and a nurture SMS based on a housing-market news item.

Brand profile (reflect this voice):
${brandLines || "Professional, warm, and helpful."}

Rules:
- Ground the copy in the news item. Be specific but do NOT fabricate statistics or quotes.
- Do NOT repeat the raw headline verbatim more than once; paraphrase it naturally into the message.
- Email: a compelling subject line (<= 80 chars) and a warm body (~90-160 words) that ties the news to the reader's home-buying/selling journey and ends with a soft call to action to book a chat using {bookingLink}.
- SMS: <= 160 characters, friendly, referencing the news angle, and include {bookingLink}. End with "Reply STOP to opt out.".
- You MAY use ONLY these merge tags: {firstName}, {lastName}, {city}, {companyName}, {bookingLink}. Do not invent other placeholders.
- Return ONLY valid minified JSON with exactly these keys: {"emailSubject":"...","emailBody":"...","smsBody":"..."}. No markdown, no commentary.`;

    const userPrompt = `News title: ${news.title}\nNews summary: ${news.summary}\nSource: ${news.source}`;

    const text = await chat({ system: systemPrompt, user: userPrompt, maxTokens: 700, json: true });
    const parsed = parseJsonBlock(text || "");
    if (parsed && parsed.emailSubject && parsed.emailBody && parsed.smsBody) {
      return {
        emailSubject: String(parsed.emailSubject).slice(0, 200),
        emailBody: String(parsed.emailBody),
        smsBody: String(parsed.smsBody),
        aiGenerated: true,
      };
    }
    return { ...fallback, aiGenerated: false };
  } catch (err) {
    console.error("[Campaign From News] AI exception:", err);
    return { ...fallback, aiGenerated: false };
  }
}

export const createCampaignFromNews = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { newsId } = req.body;
    if (!newsId) {
      return res.status(400).json({ message: "newsId is required" });
    }

    const companyId = req.user.companyId;

    const news = await prisma.scrapedNews.findFirst({
      where: { id: newsId, companyId },
    });
    if (!news) {
      return res.status(404).json({ message: "News article not found" });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, voiceProfile: true, salesBrandProfile: true },
    });

    const copy = await generateNewsCampaignCopy(news, company);

    const shortTitle = news.title.length > 60 ? news.title.slice(0, 57) + "..." : news.title;

    const campaign = await prisma.campaign.create({
      data: {
        companyId,
        name: `News: ${shortTitle}`,
        description: `Auto-drafted from market news: ${news.title}`,
        channel: "Email & SMS",
        status: "Ready", // has steps -> ready to enroll & launch
        steps: {
          // Immediate send — no wait between the email and the follow-up SMS.
          create: [
            { type: "EMAIL", position: 1, subject: copy.emailSubject, body: copy.emailBody },
            { type: "SMS", position: 2, body: copy.smsBody },
          ],
        },
      },
      include: { steps: { orderBy: { position: "asc" } } },
    });

    return res.status(201).json({ success: true, campaign, aiGenerated: copy.aiGenerated });
  } catch (error) {
    console.error("[Campaign From News] Error:", error);
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

    if (!hasLLM()) {
      return res.status(500).json({ message: "No AI provider is configured (set ANTHROPIC_API_KEY or a Groq key)." });
    }

    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
      select: { name: true, voiceProfile: true, salesBrandProfile: true },
    });
    const bp = company?.salesBrandProfile || {};
    const brandLines = [
      company?.name ? `Company/builder name: ${company.name}` : null,
      brandVoice || bp.tone || company?.voiceProfile ? `Tone/voice: ${brandVoice || bp.tone || company?.voiceProfile}` : null,
      bp.markets || bp.communities ? `Markets/communities: ${bp.markets || bp.communities}` : null,
      bp.signature ? `Signature/sign-off: ${bp.signature}` : null,
      bp.about ? `About the builder: ${bp.about}` : null,
    ].filter(Boolean).join("\n");

    const systemPrompt = `You are an expert sales copywriter specializing in home builder and warranty care lead nurturing.
Your task is to write a single ${stepType === 'SMS' ? 'text message' : 'email'} draft.

Brand profile (reflect this voice and details):
${brandLines || 'Professional, warm, and helpful.'}

Audience: ${audience || 'Homebuyers or existing homeowners'}.
Goal of this message: ${goal}.

Additional Context: ${contextInfo || 'None'}

Rules:
${stepType === 'SMS' ? '- Keep it under 160 characters if possible.\n- You may use merge tags {firstName}, {city}, {companyName}. No other placeholders.' : '- Provide a concise Subject Line.\n- Provide the Email Body.\n- You may use merge tags {firstName}, {lastName}, {city}, {companyName}, {bookingLink}. Do NOT invent other placeholders.'}
Output your draft clearly.`;

    const content = await chat({
      system: systemPrompt,
      user: "Please generate the draft copy based on the provided parameters.",
      maxTokens: 500,
    });

    if (!content) {
      return res.status(500).json({ message: "Failed to generate copy from AI provider" });
    }

    return res.json({ success: true, draft: content });
  } catch (error) {
    console.error("[Generate Copy] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
