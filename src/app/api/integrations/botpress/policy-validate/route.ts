import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { calculateWarrantyYear } from "@/lib/utils";

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

// Warranty Coverage Matrix Map
const POLICY_COVERAGE_MAP: Record<number, string[]> = {
  0: ["workmanship", "materials", "cosmetic", "drywall", "paint", "door", "window", "systems", "electrical", "plumbing", "hvac", "wiring", "pipes", "structural", "foundation", "framing", "appliances", "roof"],
  1: ["workmanship", "materials", "cosmetic", "drywall", "paint", "door", "window", "trim", "cabinet", "fixture", "systems", "electrical", "plumbing", "hvac", "wiring", "pipes", "structural", "foundation", "framing", "appliances", "roof"],
  2: ["systems", "electrical", "plumbing", "hvac", "wiring", "pipes", "ductwork", "structural", "foundation", "framing"],
  10: ["structural", "foundation", "framing", "load-bearing", "trusses"]
};

export async function POST(request: Request) {
  try {
    // 1. Verify Authentication
    if (!isAuthorized(request)) {
      return NextResponse.json({ message: "Unauthorized integration request" }, { status: 401 });
    }

    const body = await request.json();
    const { email, propertyId, address, category = "" } = body;

    if (!email) {
      return NextResponse.json({ message: "Homeowner email is required" }, { status: 400 });
    }

    // 2. Resolve homeowner
    const homeowner = await prisma.user.findUnique({
      where: { email },
      include: { properties: true }
    });

    if (!homeowner) {
      return NextResponse.json({ message: `Homeowner with email ${email} not found` }, { status: 404 });
    }

    // 3. Resolve property
    let selectedProperty: any = null;

    if (propertyId) {
      selectedProperty = homeowner.properties.find(p => p.id === propertyId);
      if (!selectedProperty) {
        selectedProperty = await prisma.property.findUnique({ where: { id: propertyId } });
      }
    } else if (address) {
      selectedProperty = homeowner.properties.find(p => 
        p.address.toLowerCase().includes(address.toLowerCase())
      );
    } else if (homeowner.properties.length > 0) {
      // Default to homeowner's first property
      selectedProperty = homeowner.properties[0];
    }

    if (!selectedProperty) {
      return NextResponse.json({ 
        message: "No active property resolved. Verify property ID or address." 
      }, { status: 404 });
    }

    // 4. Calculate Warranty Year
    const warrantyYear = calculateWarrantyYear(selectedProperty.coeDate);

    // 5. Evaluate Policy Coverage
    const cleanCategory = category.toLowerCase().trim();
    const coverageCategories = POLICY_COVERAGE_MAP[warrantyYear] || [];
    
    // Check if the input category matches any of the covered keywords
    const isCovered = coverageCategories.some(cat => 
      cleanCategory.includes(cat) || cat.includes(cleanCategory)
    ) && warrantyYear <= 10;

    // 6. Generate detailed explanation string
    let explanation = "";
    if (warrantyYear > 10) {
      explanation = `❌ Excluded: The property COE date was ${selectedProperty.coeDate ? new Date(selectedProperty.coeDate).toLocaleDateString() : 'N/A'}, which places this property in Warranty Year 11+ (Out of Warranty). All builder warranties have expired.`;
    } else if (isCovered) {
      explanation = `✅ Covered: Your property is currently in Warranty Year ${warrantyYear} (${
        warrantyYear === 0 ? "Pre-Occupancy" :
        warrantyYear === 1 ? "Materials & Workmanship" :
        warrantyYear === 2 ? "Systems & Mechanical" : "Structural"
      } coverage phase). The issue category "${category}" falls under standard builder coverage guidelines.`;
    } else {
      // Excluded
      explanation = `❌ Excluded: Your property is currently in Warranty Year ${warrantyYear} (${
        warrantyYear === 2 ? "Systems & Mechanical" : "Structural"
      } coverage phase). Cosmetic issues, workmanship details, or system components outside the structural scope (such as "${category}") are no longer covered. Homeowner maintenance is required.`;
    }

    return NextResponse.json({
      success: true,
      homeowner: {
        id: homeowner.id,
        name: homeowner.name,
        email: homeowner.email
      },
      property: {
        id: selectedProperty.id,
        address: selectedProperty.address,
        coeDate: selectedProperty.coeDate
      },
      warrantyYear,
      category,
      isCovered,
      explanation
    });

  } catch (error: any) {
    console.error("[Policy Validation] Error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
