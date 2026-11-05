/** Rows of trimmed cells. Handles quoted commas, doubled quotes and line breaks inside quotes. */
export function parseCsvText(text) {
  const input = String(text ?? "").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  const endRow = () => {
    row.push(cell.trim());
    cell = "";
    if (row.some(Boolean)) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") endRow();
    else if (ch !== "\r") cell += ch;
  }
  endRow();
  return rows;
}

/** Rows keyed by field name. Headers are normalised ("Home Owner_Email" -> "homeowneremail"), then
 *  looked up in `aliases`; unknown columns are dropped. */
export function parseCsvWithAliases(text, aliases) {
  const [headerRow, ...rows] = parseCsvText(text);
  if (!headerRow || rows.length === 0) return [];

  const headers = headerRow.map((h) => h.replace(/[\s_-]+/g, "").toLowerCase());
  return rows.map((cells) => {
    const out = {};
    headers.forEach((h, i) => {
      if (Object.hasOwn(aliases, h)) out[aliases[h]] = cells[i] ?? "";
    });
    return out;
  });
}

const LEAD_FIELD_ALIASES = [
  { key: "firstName", aliases: ["first name", "firstname", "first", "fname"] },
  { key: "lastName", aliases: ["last name", "lastname", "last", "lname"] },
  { key: "email", aliases: ["email", "e-mail", "emailaddress", "mail"] },
  { key: "phone", aliases: ["phone", "telephone", "mobile", "tel", "cell"] },
  { key: "street", aliases: ["street", "address", "address1", "location"] },
  { key: "city", aliases: ["city"] },
  { key: "state", aliases: ["state", "province"] },
  { key: "zipCode", aliases: ["zip", "zipcode", "postal", "postalcode"] },
  { key: "tags", aliases: ["tags", "labels", "interests"] },
  { key: "emailOptIn", aliases: ["email opt in", "emailoptin", "email_consent", "consent_email"] },
  { key: "smsOptIn", aliases: ["sms opt in", "smsoptin", "sms_consent", "consent_sms"] },
];

/** First guess at which lead field each column holds; the user can change it. */
export function suggestLeadMapping(headers) {
  return Object.fromEntries(
    headers.map((header) => {
      const lower = header.toLowerCase();
      const field = LEAD_FIELD_ALIASES.find((f) => f.aliases.some((alias) => lower.includes(alias)));
      return [header, field?.key || ""];
    }),
  );
}

const isTruthyCell = (value) => ["true", "yes", "1"].includes(String(value ?? "").toLowerCase());

/** Applies the user's column mapping, turning opt-in and tag cells into real values. */
export function leadsFromMapping(headers, rows, mapping) {
  return rows.map((row) => {
    const lead = {};
    headers.forEach((header, i) => {
      const field = Object.hasOwn(mapping, header) ? mapping[header] : "";
      if (!field) return;
      const value = row[i];
      if (field === "emailOptIn" || field === "smsOptIn") lead[field] = isTruthyCell(value);
      else if (field === "tags") lead[field] = value ? value.split(";").map((t) => t.trim()).filter(Boolean) : [];
      else lead[field] = value || "";
    });
    return lead;
  });
}
