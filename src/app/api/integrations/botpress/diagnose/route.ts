import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { GoogleGenAI } from "@google/genai";

// Helper to check authentication
function isAuthorized(request: Request): boolean {
  const url = new URL(request.url);
  const secretParam = url.searchParams.get("secret");
  const authHeader = request.headers.get("authorization");
  const apiKeyHeader = request.headers.get("x-api-key");

  const secret = process.env.BOTPRESS_API_SECRET || process.env.SESSION_SECRET || "super_secret_key_change_me_in_production";

  if (secretParam === secret) return true;
  if (apiKeyHeader === secret) return true;
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token === secret) return true;
  }

  return false;
}

// Simple rule-based instructions generator
function getFallbackDIY(query: string, description: string): string[] {
  const text = `${query} ${description}`.toLowerCase();
  
  if (text.includes("leak") || text.includes("clog") || text.includes("drain") || text.includes("plumbing") || text.includes("water") || text.includes("toilet") || text.includes("sink")) {
    return [
      "Locate the local shutoff valve underneath the fixture (toilet/sink) or the main water shutoff valve for the home.",
      "Turn the valve clockwise to shut off the water supply and prevent further damage.",
      "Place a bucket or towels underneath to catch residual water.",
      "For clogs, attempt to clear with a manual plunger. Avoid harsh chemical cleaners as they can damage PVC and metal pipes.",
      "Take photos of any damage or active leaks to document the issue."
    ];
  }
  
  if (text.includes("spark") || text.includes("breaker") || text.includes("electrical") || text.includes("power") || text.includes("outlet") || text.includes("switch") || text.includes("light")) {
    return [
      "Locate your main electrical breaker panel, typically in the garage, basement, or utility closet.",
      "Identify the breaker for the affected room/outlet. A tripped breaker will sit halfway between ON and OFF.",
      "Unplug any heavy appliances or fixtures on that circuit to avoid overloading upon reset.",
      "Reset the breaker by flipping it completely to OFF first, and then firmly back to the ON position.",
      "If the breaker trips again immediately, do not attempt to reset it. Unplug all devices on it and submit an urgent ticket."
    ];
  }
  
  if (text.includes("heat") || text.includes("cool") || text.includes("ac") || text.includes("hvac") || text.includes("furnace") || text.includes("thermostat") || text.includes("air")) {
    return [
      "Verify that your thermostat is set to the correct mode (HEAT or COOL) and the fan is set to AUTO.",
      "Ensure the thermostat batteries are fresh and the screen is fully powered.",
      "Check your HVAC air filter. A heavily soiled filter restricts airflow, which can cause the system to automatically trip or freeze.",
      "Confirm that all supply vents and return grilles are open and unobstructed by furniture.",
      "Check the outdoor compressor unit to make sure it is clear of debris, leaves, or snow accumulation."
    ];
  }

  if (text.includes("drywall") || text.includes("paint") || text.includes("crack") || text.includes("nail") || text.includes("wall") || text.includes("settling")) {
    return [
      "Inspect the wall surface closely to determine if the crack is minor (hairline settling) or wide (structural).",
      "Hairline cracks and nail pops are standard results of wood framing settling and shrinking during the first year.",
      "Monitor the crack over 30 days. Take a picture with a ruler next to it for scale.",
      "If the crack is cosmetic, it is typical policy for the builder to repair these in a single batch during the 11-month warranty walkthrough.",
      "Avoid patching or painting them individually beforehand, as the builder will patch and paint the entire settling list at once."
    ];
  }

  return [
    "Carefully inspect the issue and take high-resolution photos for reference.",
    "Locate the user manual, manufacturer guide, or builder instructions for the specific system or appliance.",
    "Do not attempt any disassembly or repair that makes you feel unsafe or requires specialized tools.",
    "If the issue persists or poses a threat of damage to the property, submit a ticket for formal review."
  ];
}

export async function POST(request: Request) {
  try {
    // 1. Verify Authentication
    if (!isAuthorized(request)) {
      return NextResponse.json({ message: "Unauthorized integration request" }, { status: 401 });
    }

    const body = await request.json();
    const { query = "", description = "", companyId } = body;

    if (!query && !description) {
      return NextResponse.json({ message: "Query or description is required" }, { status: 400 });
    }

    // 2. Resolve company ID
    let resolvedCompanyId = companyId;
    if (!resolvedCompanyId) {
      const company = await prisma.company.findFirst();
      resolvedCompanyId = company?.id;
    }

    if (!resolvedCompanyId) {
      return NextResponse.json({ message: "No company resolved" }, { status: 400 });
    }

    // 3. Emergency Detection
    const emergencyRegex = /fire|smoke|sparking|short circuit|gas leak|carbon monoxide|gas smell|burst pipe|flooding|sewage backup|active flood|no heat/i;
    const isEmergency = emergencyRegex.test(query) || emergencyRegex.test(description);
    let emergencyAction = "";
    if (isEmergency) {
      emergencyAction = "🚨 EMERGENCY NOTICE: Life-safety or severe property-damage hazard detected. Please vacate the premises if dangerous, shut off the main water valve/breaker immediately, and call 911 or our 24/7 hotline. An automated ticket will be escalated.";
    }

    // 4. Query Knowledge Base
    const terms = query.split(/\s+/).filter((t: string) => t.length > 2);
    let kbDocuments: any[] = [];
    
    if (terms.length > 0) {
      kbDocuments = await prisma.knowledgeBaseDocument.findMany({
        where: {
          companyId: resolvedCompanyId,
          OR: [
            { name: { contains: terms[0], mode: "insensitive" as const } },
            { url: { contains: terms[0], mode: "insensitive" as const } },
            ...(terms[1] ? [
              { name: { contains: terms[1], mode: "insensitive" as const } },
              { url: { contains: terms[1], mode: "insensitive" as const } }
            ] : [])
          ]
        },
        select: {
          id: true,
          name: true,
          url: true,
          documentType: true
        },
        take: 3
      });
    }

    // 5. DIY Guidance Generation
    let diySteps: string[] = [];
    let generatedViaAI = false;

    if (process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const prompt = `You are a home diagnostics AI assistant. Help the homeowner troubleshoot this issue: 
Query: "${query}"
Description: "${description}"

Provide 4 to 6 concise, step-by-step, actionable DIY troubleshooting tips in a clean JSON string array format.
Format:
{
  "steps": ["Step 1...", "Step 2..."]
}`;
        
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json"
          }
        });

        const textResponse = response.text;
        if (textResponse) {
          const parsed = JSON.parse(textResponse);
          if (parsed && Array.isArray(parsed.steps)) {
            diySteps = parsed.steps;
            generatedViaAI = true;
          }
        }
      } catch (geminiError) {
        console.error("[Diagnostics Webhook] Gemini AI failed, falling back to rule-based engine:", geminiError);
      }
    }

    // Fallback if Gemini not present or failed
    if (diySteps.length === 0) {
      diySteps = getFallbackDIY(query, description);
    }

    return NextResponse.json({
      success: true,
      isEmergency,
      emergencyAction: emergencyAction || null,
      diySteps,
      generatedViaAI,
      kbDocuments
    });

  } catch (error: any) {
    console.error("[Diagnostics Webhook] Error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
