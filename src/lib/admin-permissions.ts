/** Area names from server/src/lib/admin-permissions.js. The server enforces; this only hides what can't be used. */
export type AdminPermission =
  | "companies.view"
  | "companies.manage"
  | "b2b"
  | "appointments"
  | "integrations"
  | "handoffs"
  | "support"
  | "costs"
  | "prompt-lab"
  | "sales-coach";

type AdminUser = {
  isSuperAdmin?: boolean;
  isSuperStaff?: boolean;
  adminPermissions?: string[];
} | null | undefined;

/** Super Admin or Super Staff: belongs in the /admin portal, not a tenant workspace. */
export function isPlatformUser(user: AdminUser): boolean {
  return !!(user?.isSuperAdmin || user?.isSuperStaff);
}

/** True when the user holds any of the given areas. `adminPermissions` is the final list from /api/auth/me. */
export function canAdmin(user: AdminUser, ...permissions: AdminPermission[]): boolean {
  return permissions.some((p) => user?.adminPermissions?.includes(p));
}
