import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import prisma from "./prisma.js";
import { MessagingService } from "../services/messaging-service.js";
import { Templates } from "../services/templates.js";

export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase credentials");
  return createClient(url, key);
}

/**
 * Creates a login: the Supabase auth account plus the User row. Homeowner by
 * default; staff and trades pass `role`. Without a password the account gets a
 * random one and the person sets their own through a recovery link (see
 * passwordSetupLink / sendAccountInvite).
 */
export async function createHomeownerAccount({ name, email, phone = null, companyId, password = null, role = "HOMEOWNER" }) {
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
        role,
        companyId,
        phone,
      },
      select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true, avatar: true },
    });
  } catch (dbError) {
    // Roll back the auth account so the email is not left half-registered.
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    throw dbError;
  }
}

/**
 * A one-time link to choose a password (invites and "forgot password").
 * It points straight at our own page with the token; the page verifies it.
 * Supabase's action_link instead bounces through its redirect allowlist, and
 * any portal URL not on that list silently lands on the Site URL home page.
 */
export async function passwordSetupLink(email) {
  const { data, error } = await getSupabaseAdmin().auth.admin.generateLink({ type: "recovery", email });
  if (error) throw new Error(error.message);
  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) return null;
  return `${process.env.NEXT_PUBLIC_URL || ""}/forgot-password/update?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
}

/**
 * Emails a staff member or trade that a company has added them. New accounts
 * get a set-password link; a trade who already has a login (added by another
 * builder) just gets a sign-in link. Returns false when the email did not go.
 */
export async function sendAccountInvite({ email, name, companyId, roleLabel, existingAccount = false }) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, email: true },
  });
  const link = existingAccount
    ? `${process.env.NEXT_PUBLIC_URL || ""}/login`
    : await passwordSetupLink(email);
  const r = await MessagingService.sendEmail({
    companyId,
    to: email,
    subject: `${company?.name || "Aiforhomebuilder"} invited you to their warranty portal`,
    html: Templates.getAccountInviteEmail(
      { name: name || "there", roleLabel, existingAccount },
      link,
      company?.name || "Aiforhomebuilder",
    ),
    fromName: company?.name || undefined,
    fromEmail: company?.email || undefined,
    source: "account-invite",
  });
  if (!r.success) console.error(`[Invite] Email to ${email} not delivered:`, r.error || r.reason);
  return !!r.success;
}
