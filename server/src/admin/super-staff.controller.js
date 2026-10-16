import prisma from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";
import { ADMIN_PERMISSIONS, normalizeAdminPermissions } from "../lib/admin-permissions.js";
import { createHomeownerAccount, getSupabaseAdmin, passwordSetupLink } from "../lib/homeowner-account.js";
import { MailService } from "../services/mail-service.js";
import { Templates } from "../services/templates.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SELECT = { id: true, name: true, email: true, adminPermissions: true, createdAt: true };

// Staff management is the one thing never delegated: Super Admin only, checked
// here rather than through an admin area.
const wrap = (label, fn) => async (req, res) => {
  try {
    if (!req.user?.isSuperAdmin) return res.status(403).json({ message: "Only the Super Admin can manage staff." });
    await fn(req, res);
  } catch (error) {
    console.error(`[Super Staff ${label}] Error:`, error);
    res.status(error.status || 500).json({ message: error.status ? error.message : "Internal server error" });
  }
};

async function sendInvite({ email, name }) {
  const link = await passwordSetupLink(email);
  const r = await MailService.sendEmail({
    to: email,
    subject: "You've been invited to the Aiforhomebuilder admin portal",
    html: Templates.getSuperStaffInviteEmail(name || "there", link),
    noReply: true,
    source: "account-invite",
  });
  if (!r.success) console.error(`[Super Staff] Invite to ${email} not delivered:`, r.error);
  return !!r.success;
}

const findStaff = (id) => prisma.user.findFirst({ where: { id, role: "SUPER_STAFF" }, select: SELECT });

export const listSuperStaff = wrap("List", async (req, res) => {
  const staff = await prisma.user.findMany({
    where: { role: "SUPER_STAFF" },
    select: SELECT,
    orderBy: { createdAt: "desc" },
  });
  res.json({ staff, permissionCatalogue: ADMIN_PERMISSIONS });
});

export const inviteSuperStaff = wrap("Invite", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!name || !EMAIL_RE.test(email)) return res.status(400).json({ message: "Enter a name and a valid email." });
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    return res.status(400).json({ message: "An account with this email already exists." });
  }

  const created = await createHomeownerAccount({ name, email, companyId: null, role: "SUPER_STAFF" });
  const member = await prisma.user.update({
    where: { id: created.id },
    data: { adminPermissions: normalizeAdminPermissions(req.body.permissions) },
    select: SELECT,
  });
  const emailed = await sendInvite({ email, name });
  writeAuditLog({ req, action: "SUPER_STAFF_INVITED", targetType: "User", targetId: member.id, metadata: { email, permissions: member.adminPermissions } });
  res.status(201).json({ member, emailed });
});

export const updateSuperStaff = wrap("Update", async (req, res) => {
  const member = await findStaff(req.params.id);
  if (!member) return res.status(404).json({ message: "Staff member not found." });
  const updated = await prisma.user.update({
    where: { id: member.id },
    data: {
      adminPermissions: normalizeAdminPermissions(req.body.permissions),
      ...(typeof req.body.name === "string" && req.body.name.trim() ? { name: req.body.name.trim() } : {}),
    },
    select: SELECT,
  });
  writeAuditLog({
    req,
    action: "SUPER_STAFF_UPDATED",
    targetType: "User",
    targetId: member.id,
    metadata: { email: member.email, from: member.adminPermissions, to: updated.adminPermissions },
  });
  res.json({ member: updated });
});

export const resendSuperStaffInvite = wrap("Resend", async (req, res) => {
  const member = await findStaff(req.params.id);
  if (!member) return res.status(404).json({ message: "Staff member not found." });
  res.json({ emailed: await sendInvite(member) });
});

export const removeSuperStaff = wrap("Remove", async (req, res) => {
  const member = await findStaff(req.params.id);
  if (!member) return res.status(404).json({ message: "Staff member not found." });

  // ponytail: scans up to 1000 auth users; page through listUsers if the platform outgrows that.
  const supabaseAdmin = getSupabaseAdmin();
  const { data } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  const authUser = data?.users?.find((u) => u.email?.toLowerCase() === member.email);
  if (authUser) await supabaseAdmin.auth.admin.deleteUser(authUser.id);
  await prisma.user.delete({ where: { id: member.id } });

  writeAuditLog({ req, action: "SUPER_STAFF_REMOVED", targetType: "User", targetId: member.id, metadata: { email: member.email } });
  res.json({ success: true });
});
