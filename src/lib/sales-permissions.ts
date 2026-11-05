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

/** `salesPermissions` is the final list from /api/auth/me; the server owns the rules. This only hides what can't be used. */
export function hasSalesPermission(
  user: { salesPermissions?: string[] } | null | undefined,
  permission: SalesPermission,
): boolean {
  return !!user?.salesPermissions?.includes(permission);
}
