import prisma from "../lib/prisma.js";
import { GoogleGenAI } from "@google/genai";

export const getCalendarEvents = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const events = await prisma.contentCalendar.findMany({
      where: { companyId: req.user.companyId },
      orderBy: { scheduledAt: "asc" },
    });

    return res.json(events);
  } catch (error) {
    console.error("[Calendar GET] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createCalendarEvent = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { title, channel, scheduledAt, content, subject, reason, outline, isAiSuggested } = req.body;

    if (!title || !channel || !scheduledAt || !content) {
      return res.status(400).json({ message: "Missing required fields: title, channel, scheduledAt, content" });
    }

    const event = await prisma.contentCalendar.create({
      data: {
        companyId: req.user.companyId,
        title,
        channel,
        scheduledAt: new Date(scheduledAt),
        content,
        subject: subject || null,
        reason: reason || null,
        outline: outline || null,
        isAiSuggested: !!isAiSuggested,
        status: "Scheduled",
      },
    });

    return res.status(201).json(event);
  } catch (error) {
    console.error("[Calendar Create] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getCalendarSuggestions = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
    });

    const voiceProfile = company?.voiceProfile || "professional";
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `You are an AI assistant for a homebuilder. Generate exactly 3 content calendar suggestions for nurture campaigns (SMS/Email) targeting new leads or post-closing homeowners. The company's communication voice profile is: "${voiceProfile}".
          
          Provide the output as a raw JSON array matching this structure:
          [
            {
              "id": "string",
              "topic": "string",
              "channel": "Email" | "SMS",
              "date": "string",
              "reason": "string",
              "outline": "string"
            }
          ]
          Return ONLY the JSON array without any markdown formatting or surrounding blocks.`,
        });

        const text = response.text || "";
        const cleanedText = text.replace(/```json/g, "").replace(/```/g, "").trim();
        const suggestions = JSON.parse(cleanedText);
        return res.json(suggestions);
      } catch (geminiError) {
        console.warn("[Gemini API] Failed to generate suggestions, using high-quality defaults:", geminiError);
      }
    }

    // High quality customized default suggestions fallback
    const defaults = [
      {
        id: "S-1",
        topic: "Post-COE Move-In Anniversary Nurture",
        channel: "Email",
        date: "June 25",
        reason: `Gap detected: Lead has completed closing (COE) and is in Day 30 without feedback outreach. Scoped for "${voiceProfile}" voice.`,
        outline: "Friendly check-in about their first 30 days in the new community, attaching a service request form and local builder contacts.",
      },
      {
        id: "S-2",
        topic: "Mortgage Lock Rate drop alert broadcast",
        channel: "SMS",
        date: "June 28",
        reason: "Market Event: Federal interest rate drop trends observed. Ideal for cold buyer leads.",
        outline: "Quick text: 'Great news! Home loan rates just dropped. Let's look at how much you'll save on monthly payments. Tap here to view slots.'",
      },
      {
        id: "S-3",
        topic: "Energy Efficiency Guarantee brochure share",
        channel: "Email",
        date: "July 2",
        reason: "Educational: Target engaged leads who toured models but haven't reserved a home yet.",
        outline: "Highlights the structural insulations, double-pane windows, and smart utility meters that save homeowners an average of $150/mo.",
      }
    ];

    return res.json(defaults);
  } catch (error) {
    console.error("[Calendar Suggestions] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
