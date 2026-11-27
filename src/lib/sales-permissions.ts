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

/** Same wording as the server's catalogue (server/src/lib/permissions.js), for messages. */
export const SALES_PERMISSION_LABELS: Record<SalesPermission, string> = {
  "csv.upload": "Import leads (CSV)",
  "campaigns.manage": "Manage campaigns",
  "announcements.publish": "Publish announcements",
  "blog.manage": "Draft & publish blog posts",
  "automations.manage": "Manage automations",
  "settings.manage": "Manage workspace settings",
  "kb.manage": "Manage knowledge base",
};

/** `salesPermissions` is the final list from /api/auth/me; the server owns the rules. This only hides what can't be used. */
export function hasSalesPermission(
  user: { salesPermissions?: string[] } | null | undefined,
  permission: SalesPermission,
): boolean {
  return !!user?.salesPermissions?.includes(permission);
}
