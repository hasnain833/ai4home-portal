export function calculateWarrantyYear(coeDate) {
  if (!coeDate) return 1;
  const coe = new Date(coeDate);
  const now = new Date();
  const diffTime = now.getTime() - coe.getTime();
  const diffYears = diffTime / (1000 * 60 * 60 * 24 * 365.25);
  
  if (diffYears < 0) return 0;
  if (diffYears <= 1) return 1;
  if (diffYears <= 2) return 2;
  return 10;
}

export async function mapWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];

  const max = Math.max(1, Math.min(Number(limit) || 1, list.length));
  const results = new Array(list.length);
  let cursor = 0;

  async function runner() {
    while (true) {
      const index = cursor++;
      if (index >= list.length) return;
      try {
        results[index] = { value: await worker(list[index], index) };
      } catch (error) {
        results[index] = { error };
      }
    }
  }

  await Promise.all(Array.from({ length: max }, runner));
  return results;
}

const RETRYABLE_PRISMA_CODES = new Set(["P1001", "P1002", "P1008", "P1017"]);

const RETRYABLE_SYSCALL_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EHOSTUNREACH",
]);

const RETRYABLE_MESSAGE_RE =
  /connection.*(closed|terminated|reset)|server closed|timeout|Closed|too many clients|Connection terminated/i;

export function isTransientDbError(err) {
  if (!err) return false;
  if (RETRYABLE_PRISMA_CODES.has(err.code)) return true;
  if (RETRYABLE_SYSCALL_CODES.has(err.code)) return true;
  if (err.cause && isTransientDbError(err.cause)) return true;
  return RETRYABLE_MESSAGE_RE.test(String(err.message || ""));
}

export async function withDbRetry(fn, { retries = 2, baseDelayMs = 50, label = "db" } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransientDbError(err) || attempt === retries) throw err;
      const delay = baseDelayMs * 2 ** attempt;
      console.warn(
        `[DB Retry] ${label}: transient error (${err.code || "no code"}) — ` +
        `retry ${attempt + 1}/${retries} in ${delay}ms: ${err.message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}


export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

export function safeUrl(raw) {
  const url = String(raw || "").trim();
  if (!url) return null;
  if (!/^(https?:|mailto:|tel:)/i.test(url)) return null;
  return url
    .replace(/&/g, "&amp;")
    .replace(/"/g, "%22")
    .replace(/'/g, "%27")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E");
}

export function renderMergeFields(
  template,
  vars = {},
  { html = false, raw, blankUnknown = false } = {},
) {
  if (!template) return "";
  return String(template).replace(
    /\{\{?\s*(\w+)\s*\}?\}/g,
    (match, key) => {
      if (!Object.prototype.hasOwnProperty.call(vars, key)) {
        return blankUnknown ? "" : match;
      }
      const value = vars[key];
      if (value == null) return "";
      if (html && !(raw && raw.has(key))) return escapeHtml(String(value));
      return String(value);
    },
  );
}

export function leadMergeVars(lead, extra = {}) {
  return {
    firstName: lead?.firstName || "",
    lastName: lead?.lastName || "",
    fullName: [lead?.firstName, lead?.lastName].filter(Boolean).join(" "),
    email: lead?.email || "",
    phone: lead?.phone || "",
    city: lead?.city || "",
    state: lead?.state || "",
    status: lead?.status || "",
    companyName: lead?.companyName || lead?.company?.name || "",
    ...extra,
  };
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3}[\s.-]?\d{3,4}(?:[\s.-]?\d{1,4})?/g;
const LONG_DIGITS_RE = /\b\d{9,}\b/g;

export function redactPII(text) {
  if (!text) return "";
  return String(text)
    .replace(EMAIL_RE, "[email redacted]")
    .replace(LONG_DIGITS_RE, "[number redacted]")
    .replace(PHONE_RE, (m) => (/\d{7,}/.test(m.replace(/\D/g, "")) ? "[phone redacted]" : m));
}

export function minimalLeadContext(lead) {
  return {
    firstName: lead?.firstName || "there",
    city: lead?.city || null,
    state: lead?.state || null,
  };
}
