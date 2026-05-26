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
    });

    if (!dbUser) {
      // If user doesn't exist in Prisma but logged in via Supabase, create them
      dbUser = await prisma.user.create({
        data: {
          email,
          password: "supabase-auth", // Managed by supabase
          name: user.user_metadata?.name || email.split("@")[0],
          role: "HOMEOWNER", // Default role
        },
      });
    }

    return NextResponse.json({
      ...dbUser,
      role: dbUser.role.toLowerCase(), // Normalize ADMIN→admin, HOMEOWNER→homeowner etc.
    });
  } catch (error) {
    console.error("Auth me error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

