import { createClient } from "@/lib/supabase/server";
import prisma from "@/lib/prisma";

export async function getServerSession(request?: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user || !user.email) return null;

    // Fetch the Prisma user
    const dbUser = await prisma.user.findUnique({
      where: { email: user.email },
    });

    if (!dbUser) return null;

    return {
      ...dbUser,
      role: typeof dbUser.role === 'string' ? dbUser.role.toUpperCase() : dbUser.role,
    };
  } catch (error) {
    console.error("getServerSession error:", error);
    return null;
  }
}
