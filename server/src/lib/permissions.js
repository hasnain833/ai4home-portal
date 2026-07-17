
export const SALES_PERMISSIONS = {
  "csv.upload": {
    label: "Import leads (CSV)",
    description: "Upload CSV files and run lead imports.",
    homeowner: true,
  },
  "campaigns.manage": {
    label: "Manage campaigns",
    description: "Create, edit, enroll leads into, and launch nurture sequences.",
    homeowner: true,
  },
  "announcements.publish": {
    label: "Publish announcements",
    description:
      "Create and send builder announcements. SW-ANN-006 restricts publishing to admins and authorized members.",
    homeowner: false, 
  },
  "blog.manage": {
    label: "Draft & publish blog posts",
    description: "Generate, edit, approve and publish blog content.",
    homeowner: false, 
  },
  "automations.manage": {
    label: "Manage automations",
    description: "Create and activate automation rules.",
    homeowner: false,
  },
  "kb.manage": {
    label: "Manage knowledge base",
    description: "Upload and remove KB documents, and edit the brand profile.",
    homeowner: false, 
  },
};

export const ALL_SALES_PERMISSIONS = Object.keys(SALES_PERMISSIONS);

export function normalizeSalesPermissions(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((p) => ALL_SALES_PERMISSIONS.includes(p)))];
}
export function hasSalesPermission(user, permission) {
  if (!user) return false;
  if (user.isSuperAdmin) return true;

  const role = String(user.role || "").toUpperCase();
  if (role === "ADMIN") return true;

  if (role === "HOMEOWNER") return SALES_PERMISSIONS[permission]?.homeowner === true;

  if (role !== "STAFF") return false;
  return Array.isArray(user.salesPermissions) && user.salesPermissions.includes(permission);
}

export function effectiveSalesPermissions(user) {
  if (!user) return [];
  const role = String(user.role || "").toUpperCase();
  if (user.isSuperAdmin || role === "ADMIN") return [...ALL_SALES_PERMISSIONS];
  if (role === "HOMEOWNER") {
    return ALL_SALES_PERMISSIONS.filter((p) => SALES_PERMISSIONS[p].homeowner === true);
  }
  if (role !== "STAFF") return [];
  return normalizeSalesPermissions(user.salesPermissions);
}
