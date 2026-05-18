import prisma from "@/lib/prisma";
import { GoogleGenAI } from "@google/genai";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export class AIService {
  static async getChatResponse(messages: ChatMessage[], companyId: string) {
    // 1. Fetch Agent Configuration
    const config = await prisma.agentConfig.findFirst({
      where: { companyId, isActive: true },
      orderBy: { createdAt: "desc" },
    });

    const systemPrompt = config?.systemPrompt || "You are a helpful warranty care assistant.";
    
    // 2. Fetch Knowledge Base Context (RAG Retrieval)
    const lastUserMessage = messages[messages.length - 1]?.content || "";
    const kbDocs = await prisma.knowledgeBaseDocument.findMany({
      where: {
        companyId,
        isIndexed: true,
        OR: [
          { name: { contains: lastUserMessage, mode: 'insensitive' } },
          { content: { contains: lastUserMessage, mode: 'insensitive' } },
        ]
      },
      take: 4
    });

    let context = "";
    if (kbDocs.length > 0) {
      context = "\n\nRelevant Knowledge Base context extracted from documents:\n" + 
        kbDocs.map(d => `--- DOCUMENT [${d.documentType}]: ${d.name} ---\n${d.content?.substring(0, 1000)}...`).join("\n\n");
    }

    // 3. Construct the prompt for the LLM Generation (RAG Generation)
    const emergencyKeywords = ["leak", "fire", "smoke", "flood", "electricity", "danger", "burst", "emergency"];
    const hasEmergencyKeywords = emergencyKeywords.some(kw => lastUserMessage.toLowerCase().includes(kw));

    const fullPrompt = `System Persona: ${systemPrompt}

${context}

Here is the conversation history:
${messages.map(m => `${m.role}: ${m.content}`).join("\n")}

Based on the latest user message and the provided documentation context (if any), please generate a response. 
Follow these rules:
1. Determine if this is an emergency (life-safety issues like fire, active flooding). If so, flag isEmergency as true and output the escalation message: "${config?.escalationMessage || "🚨 This is a critical emergency. I am escalating this immediately."}".
2. If there are step-by-step DIY instructions in the context that solve the issue, extract up to 5 steps into the diySteps array.
3. Formulate a polite, helpful response in the "content" field.

Output EXACTLY in this JSON format without markdown ticks:
{
  "content": "Your response to the homeowner here...",
  "isEmergency": true,
  "diySteps": ["Step 1...", "Step 2..."],
  "createTicket": true,
  "issueSummary": "Short 3-5 word summary of the issue (e.g. Plumbing Leak)"
}`;

    // Initialize Gemini API
    if (process.env.GEMINI_API_KEY) {
      try {
        console.log(`[AI Service] Using Gemini API for real generation...`);
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: fullPrompt,
          config: {
            responseMimeType: "application/json"
          }
        });

        if (response.text) {
          const result = JSON.parse(response.text);
          return {
            content: result.content || "I understand. Let me help you with that.",
            isEmergency: result.isEmergency || false,
            diySteps: result.diySteps || [],
            createTicket: result.createTicket || false,
            issueSummary: result.issueSummary || "General Issue",
            usage: { tokens: 150 }
          };
        }
      } catch (e) {
        console.error("[AI Service] Gemini API failed, falling back to mock:", e);
      }
    } else {
      console.warn("[AI Service] GEMINI_API_KEY not found in .env, using fallback simulation.");
    }

    // Fallback Simulation Logic (if API fails or no key)
    const diyGuides = kbDocs.filter(d => d.documentType === "DIY_GUIDE" || d.documentType === "VIDEO");
    let responseText = "";
    let diySteps: string[] = [];

    if (hasEmergencyKeywords) {
      responseText = config?.escalationMessage || "🚨 This sounds like a critical emergency. I am escalating this immediately to our priority service team and flagging it as life-safety.";
    } else if (diyGuides.length > 0) {
      responseText = `I've found a Self-Fix guide that might help you resolve this issue immediately. `;
      diySteps = diyGuides[0].content?.split("\n").filter(line => line.match(/^\d\./)).slice(0, 5) || [];
      if (diySteps.length === 0) responseText += `Please refer to the "${diyGuides[0].name}" guide. `;
      else responseText += `Here are the key steps from our "${diyGuides[0].name}":`;
    } else if (kbDocs.length > 0) {
      responseText = `I've analyzed your issue regarding "${lastUserMessage}". According to our documentation (${kbDocs[0].name}), this is covered under your Year ${lastUserMessage.includes("year") ? "2" : "1"} warranty. `;
    } else {
      responseText = `I've analyzed your issue regarding "${lastUserMessage}". I'll look into our policies. Would you like me to open a ticket for our staff to review?`;
    }

    return {
      content: responseText,
      isEmergency: hasEmergencyKeywords,
      diySteps,
      createTicket: hasEmergencyKeywords,
      issueSummary: "General Issue",
      usage: { tokens: 50 }
    };
  }
}
