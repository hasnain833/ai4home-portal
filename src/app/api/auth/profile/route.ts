import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user || !user.email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, avatar } = body;

    const updateData: Record<string, string> = {};
    if (name) updateData.name = name;
    if (avatar !== undefined) updateData.avatar = avatar;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ message: "No db fields updated" }, { status: 200 });
    }

    // Ensure we update the Prisma user
    const updatedDbUser = await prisma.user.update({
      where: { email: user.email },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
      }
    });

    return NextResponse.json(updatedDbUser);
  } catch (error) {
    console.error("Profile update error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
