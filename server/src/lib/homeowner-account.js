import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import prisma from "./prisma.js";

export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase credentials");
  return createClient(url, key);
}

/**
 * Creates a homeowner login: the Supabase auth account plus the User row.
 * Without a password the account gets a random one; the homeowner sets their
 * own through a recovery link (see passwordSetupLink).
 */
export async function createHomeownerAccount({ name, email, phone = null, companyId, password = null }) {
  const secret = password || randomBytes(24).toString("base64url");
  const supabaseAdmin = getSupabaseAdmin();
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: secret,
    email_confirm: true,
    user_metadata: { name },
  });
  if (authError) {
    const err = new Error(authError.message || "Failed to create authentication account");
    err.status = 400;
    throw err;
  }

  try {
    return await prisma.user.create({
      data: {
        name,
        email,
        password: await bcrypt.hash(secret, 10),
        role: "HOMEOWNER",
        companyId,
        phone,
      },
      select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true },
    });
  } catch (dbError) {
    // Roll back the auth account so the email is not left half-registered.
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    throw dbError;
  }
}

/** A one-time link the homeowner uses to choose their password. */
export async function passwordSetupLink(email) {
  const { data, error } = await getSupabaseAdmin().auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${process.env.NEXT_PUBLIC_URL}/forgot-password/update` },
  });
  if (error) throw new Error(error.message);
  return data.properties?.action_link || null;
}
