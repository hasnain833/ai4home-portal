/**
 * Client-side mirror of the server's sales permission keys.
 *
 * This is for showing and hiding UI only. Every one of these is also enforced
 * on the server by `requirePermission`, and that check is the one that actually
 * protects anything — hiding a button does not stop a request.
 */

export const SALES_PERMISSION = {
  csvUpload: "csv.upload",
  campaignsManage: "campaigns.manage",
  announcementsPublish: "announcements.publish",
  blogManage: "blog.manage",
  automationsManage: "automations.manage",
  kbManage: "kb.manage",
  settingsManage: "settings.manage",
} as const;

export type SalesPermission = (typeof SALES_PERMISSION)[keyof typeof SALES_PERMISSION];

type PermissionUser = {
  role?: string;
  isSuperAdmin?: boolean;
  salesPermissions?: string[];
} | null | undefined;

/** Mirrors `hasSalesPermission` in server/src/lib/permissions.js. */
export function hasSalesPermission(user: PermissionUser, permission: SalesPermission): boolean {
  if (!user) return false;
  if (user.isSuperAdmin) return true;

  const role = String(user.role || "").toLowerCase();
  if (role === "admin") return true;
  if (role !== "staff") return false;

  return Array.isArray(user.salesPermissions) && user.salesPermissions.includes(permission);
}
