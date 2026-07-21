## 🏗️ Infrastructure & Security
- [ ] 🟡 **`NFR-S-003` — Secrets / encryption at rest.**
  - [ ] Set a strong `APP_ENCRYPTION_KEY` in production and re-encrypt any secrets
        written under the old default key (operational — see below).
  - [ ] Optional: move all provider secrets to a real secrets vault.
- [ ] 🟡 **Compliance & privacy.**
  - [ ] 🔵 `NFR-S-006` — **needs a decision, but not the one the SRS implies.**
        Audited 2026-07-21: **CSVs are never uploaded to the server at all.** The
        browser parses the file and posts pre-mapped JSON (`leadsList`);
        `uploadCsvMiddleware` is a no-op and the comment says multer was removed. So
        "virus-scan uploaded CSVs" has no file to scan and "30-day retention" has
        nothing to purge — retention is already zero. **As written, N/A.**
        ⚠️ **The risk moved rather than vanished.** There *are* unscanned uploads:
        `kb.controller.js` (≤50MB → Supabase Storage) and `company.controller.js`
        (logo + verification doc). The KB one is the concern — uploaded files are
        published via `getPublicUrl()`, so tenant documents are reachable by anyone
        with the link, which also sits oddly beside the tenant-scoping the KB
        otherwise enforces. **Decide:** re-point the requirement at KB/company
        uploads (scan + signed URLs instead of public), or sign off the de-scope.
  - [ ] `NFR-S-005` — GDPR / CCPA data export & delete. _(Not started — the
        `SUPPORT_LEAD_ACCESS` / `auditMutations` trail now gives the "who touched
        this data" half, but subject-access export and erasure are still to build.)_

---

## ⚡ Performance & code quality (NFR-P / reusability)
- [ ] 🟡 **Frontend fetch waterfalls (`NFR-P-001`).** ~23 `useEffect` fetches across
      the sales/warranty pages; consider SWR/React Query or parallelizing initial loads.
      _(Partially reduced by the pagination work above — the dashboard and campaigns
      pages no longer pull whole lead tables — but not yet addressed systematically.)_

---

## 🏢 Additional Client Requests (beyond the SRS)

- [ ] 🔴 **Literal payment / invoice gating.** Upload invoice, "clear invoices to
      proceed", auto-share invoice, welcome email after first invoice paid. The
      document-verification gate shipped instead (env-only super-admin login,
      `/admin` UI, welcome email on approval, gated by `Company.verificationStatus` —
      no Invoice/Payment model) — decide with the client whether real invoicing is
      still required.

---
## ❓ Needs a client decision (outside current SRS)

- [ ] 🔴 **Per-company AI/LLM API key from the frontend** _(contradicts SRS)._ A
      note asked to _"send the Claude/other API key in the env to the frontend so
      every company puts their own."_ The SRS specifies the **opposite**: `SW-AGT-002`
      wants a **shared platform** LLM service (`Claude, configurable` = platform swaps
      providers, not per-tenant BYO key), and `NFR-S-003` requires provider keys to
      live in a secrets manager, **never exposed** — shipping a key to the browser
      would violate it. If per-tenant AI billing/keys are genuinely wanted, it must be
      stored and used **server-side only**, and needs explicit client sign-off first.

---
