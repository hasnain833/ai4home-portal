export const CSV_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLeadRow(lead) {
  const firstName = (lead?.firstName || "").trim();
  const lastName = (lead?.lastName || "").trim();
  const email = (lead?.email || "").trim();

  if (!firstName || !lastName) {
    return { valid: false, reason: "First name and last name are required." };
  }
  if (email && !CSV_EMAIL_REGEX.test(email)) {
    return { valid: false, reason: `Invalid email format: ${email}` };
  }
  return { valid: true };
}
const FORMULA_INJECTION_RE = /^[=+\-@\t\r]/;

export function sanitizeCsvValue(value) {
  if (typeof value !== "string") return value;
  if (FORMULA_INJECTION_RE.test(value.replace(/^\s+/, ""))) {
    return "'" + value;
  }
  return value;
}

export function leadDedupKeys(lead) {
  const keys = [];
  const email = (lead?.email || "").trim().toLowerCase();
  const phone = (lead?.phone || "").replace(/\D/g, "");
  if (email) keys.push("email:" + email);
  if (phone) keys.push("phone:" + phone.slice(-10));
  return keys;
}
