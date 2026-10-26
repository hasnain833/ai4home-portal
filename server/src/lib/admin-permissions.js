// Areas of the Super Admin portal a Super Staff member can be given. The
// Super Admin always has all of them; managing staff is never one of them.
export const ADMIN_PERMISSIONS = {
  "companies.view": {
    label: "View companies",
    description: "See the companies list and the Overview numbers.",
  },
  "companies.manage": {
    label: "Manage companies",
    description: "Verify, suspend or reactivate companies, change workspaces and onboarding.",
  },
  b2b: {
    label: "Business leads & campaigns",
    description: "Manage B2B leads, campaigns and enrollments.",
  },
  appointments: {
    label: "Appointments",
    description: "See demo bookings and set booking availability.",
  },
  integrations: {
    label: "CRM & News",
    description: "CRM health, default news sources and the security checklist.",
  },
  handoffs: {
    label: "Hand-off issues",
    description: "Retry or resolve failed Closed Won hand-offs.",
  },
  support: {
    label: "Support access",
    description: "Look up a company's leads for support, the access log and the support phone number.",
  },
  costs: {
    label: "Usage & costs",
    description: "See messaging spend and change messaging prices.",
  },
  "prompt-lab": {
    label: "Prompt Lab",
    description: "Edit and set live the Sales, Warranty and Help agent prompts and the platform KB.",
  },
  "sales-coach": {
    label: "Sales Coach",
    description: "Practise selling AI4Home with the AI role-play partner and ask the Coach.",
  },
};

const ALL = Object.keys(ADMIN_PERMISSIONS);

export function normalizeAdminPermissions(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((p) => ALL.includes(p)))];
}

export function effectiveAdminPermissions(user) {
  if (user?.isSuperAdmin) return [...ALL];
  if (user?.isSuperStaff) return normalizeAdminPermissions(user.adminPermissions);
  return [];
}

export function hasAnyAdminPermission(user, permissions) {
  const held = effectiveAdminPermissions(user);
  return permissions.some((p) => held.includes(p));
}
