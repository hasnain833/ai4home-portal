// Shared by lead persistence and SMS delivery. Keep the SQL normalizer in
// prisma/sql/lead-phone-uniqueness.sql consistent with this function.
export const PHONE_ERROR = "Only +1 phone numbers are supported, e.g. +1 (555) 123-4567.";
export const PHONE_CONFLICT = "This phone number is already assigned to another lead. Use a different number or contact an administrator.";

export function toE164(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const withCountry = digits.length === 10 && !raw.startsWith("+") ? `1${digits}` : digits;
  return /^1[2-9]\d{9}$/.test(withCountry) ? `+${withCountry}` : undefined;
}

export function leadPhoneError(message, status) {
  return Object.assign(new Error(message), { status, expose: true, code: status === 409 ? "LEAD_PHONE_CONFLICT" : "LEAD_PHONE_INVALID" });
}

export function isLeadPhoneError(error) {
  return ["LEAD_PHONE_CONFLICT", "LEAD_PHONE_INVALID"].includes(error?.code);
}

function normalizeData(data) {
  if (!data || !Object.hasOwn(data, "phone")) return data;
  const value = data.phone && typeof data.phone === "object" ? data.phone.set : data.phone;
  // Prisma treats undefined as an omitted field.
  if (value === undefined) return data;
  const phone = toE164(value);
  if (phone === undefined) throw leadPhoneError(PHONE_ERROR, 400);
  return { ...data, phone };
}

// Every lead write uses the same normalizer, including interactive transactions,
// imports and CRM sync. The database registry is the shared, atomic duplicate
// check; no read-before-write race or query outside the caller's transaction.
export const leadPhoneExtension = {
  name: "lead-phone-uniqueness",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (model !== "Lead" && model !== "B2BLead") return query(args);
        if (operation === "upsert") {
          args = { ...args, create: normalizeData(args.create), update: normalizeData(args.update) };
        } else if (["create", "update", "updateMany", "updateManyAndReturn", "createMany", "createManyAndReturn"].includes(operation)) {
          args = { ...args, data: Array.isArray(args.data) ? args.data.map(normalizeData) : normalizeData(args.data) };
        }
        try {
          return await query(args);
        } catch (error) {
          const details = `${error?.message || ""} ${JSON.stringify(error?.meta || {})}`;
          if (details.includes("lead_phone_registry_phone_key") || details.includes("LEAD_PHONE_CONFLICT") ||
              (error?.code === "P2002" && Array.isArray(error.meta?.target) && error.meta.target.includes("phone"))) {
            throw leadPhoneError(PHONE_CONFLICT, 409);
          }
          if (details.includes("LEAD_PHONE_INVALID")) throw leadPhoneError(PHONE_ERROR, 400);
          throw error;
        }
      },
    },
  },
};
