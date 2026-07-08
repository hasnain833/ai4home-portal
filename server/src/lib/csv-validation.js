// Shared CSV lead-row validation, used by both the pre-commit dry-run
// (/api/sales/csv/validate) and the background import job so the preview counts
// always match what the import actually does.

export const CSV_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validate a single mapped lead row. Returns { valid: boolean, reason?: string }.
// Mirrors the import job's hard-reject rules: name is required; a present email
// must be well-formed.
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

// Dedup keys used to detect duplicates (email, and last-10 digits of phone).
export function leadDedupKeys(lead) {
  const keys = [];
  const email = (lead?.email || "").trim().toLowerCase();
  const phone = (lead?.phone || "").replace(/\D/g, "");
  if (email) keys.push("email:" + email);
  if (phone) keys.push("phone:" + phone.slice(-10));
  return keys;
}
