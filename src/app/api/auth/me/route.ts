import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();

    // Use getUser() for security — validates JWT with Supabase server.
    // This route is called once at login/mount, so the network cost is acceptable.
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user?.email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const email = user.email;

    // Find the user in Prisma by email
    let dbUser = await prisma.user.findUnique({
      where: { email },
      include: { company: true },
    });

    if (!dbUser) {
      return NextResponse.json({ message: "User profile not found in local database." }, { status: 404 });
    }

    // Admin → company logo as avatar; Staff/Homeowner → their own personal avatar
    const isAdmin = dbUser.role === "ADMIN";
    const avatarUrl = isAdmin
      ? (dbUser.company?.logo || null)
      : (dbUser.avatar || null);

    return NextResponse.json({
      ...dbUser,
      avatar: avatarUrl,
      companyLogo: dbUser.company?.logo || null, // Always the company logo, for the header
      companyName: dbUser.company?.name || null,
      role: dbUser.role.toLowerCase(),
      online: true,
    });
  } catch (error) {
    console.error("Auth me error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

