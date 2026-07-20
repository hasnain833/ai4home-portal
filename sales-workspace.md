# Sales Workspace — Task Board

Tracks the **open** work for the Sales Workspace against the **Ai.Lumen Sales
Workspace SRS v1.1** (`sales-workspace-srs.pdf`). For the warranty side see
[`warranty-workspace.md`](./warranty-workspace.md).

_Last updated: 2026-07-20 (SW-KB/SW-AGT shipped + schema pushed; homeowner audit,
Sales-AI helper consolidation, and first performance pass recorded below)._

> **Runtime note** — Per SRS §11.4, the Sales AI features run on the native
> **Claude + Inngest** runtime. Botpress is the Warranty-workspace bot engine
> only.

### Legend

- `- [ ]` open task · `- [x]` done.
- 🔴 **Open** (not started) · 🟡 **Partial** (core works, gaps remain) · ⚙️ **Operational** (code done, one-time env/DB step pending) · ✅ **Done**.

---

## 🧩 Cross-cutting SRS Coverage
  - [ ] 🟡 **Still open: Homeowner "limited templates"** (matrix: nurture sequences
        = "Yes (limited templates)"). The SRS never defines what limits a template, so
        there's nothing to implement against. Needs a product definition before it can
        be built — deliberately not invented here.
  - [ ] 🟡 **Homeowner role — Sales matrix gaps (audited 2026-07-20).** The permission
        layer (`server/src/lib/permissions.js`) matches §4.12: CSV import + nurture are
        homeowner-allowed; announcements/blog/automations/KB are denied; leads are
        scoped to `ownerId=self`. Two matrix rights are **not** wired:
    - [ ] **Content calendar "view own items":** `getCalendarEvents`
          (`calendar.controller.js`) returns all company events with no owner filter
          for homeowners; create/update/transition aren't owner-scoped either.
    - [ ] **Appointment scheduling "own availability":** every `/scheduling/*` route is
          `requireRoles(["ADMIN","STAFF"])`, so a homeowner can't reach their own
          availability. Possibly an intended de-scope per assumption #7 (homeowner lead
          use is a lightweight subset) — needs a sign-off either way.
    - _Warranty-side homeowner touchpoints (report issue / DIY / claim + ticket # /
      status reminders) are delivered by the Botpress agent, not portal code — no
      portal gap there by design._
  - [ ] 🟡 **Still open: Platform-Admin views.** `SUPER_ADMIN` exists and bypasses
        `requireWorkspace`; `/admin` covers companies/users/verification. Not yet mapped
        against the matrix's Platform-Admin column: "CRM connect/manage → **View
        health**", "News feed → **Manage default sources**", "Lead view/manage →
        **Support access (audited)**".

---

## ✅ Verified built (2026-07-17 audit)

Checked requirement-by-requirement against `sales-workspace-srs.pdf` this pass and
confirmed **implemented** — recorded so a future audit doesn't re-open them.
Anything not listed here and not open above was not individually re-verified.

| Area                   | Verified                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hub §3**             | `HUB-005` route prefixes (`/warranty`, `/sales`) · `HUB-006` last-workspace memory (`src/app/page.tsx` — user pref → localStorage → cookie) · `HUB-009` per-tenant flags (`Company.salesEnabled` / `warrantyEnabled`)                                                                                            |
| **Lead model §4.0**    | `SW-LEAD-001` all required fields incl. consent + timestamp + source, `customFields`, tags · `SW-LEAD-003` dedup (`lead-dedup.js`) · `SW-LEAD-004` segments evaluated at send time (`buildPrismaWhereClause`) · `SW-LEAD-005` timeline · `SW-LEAD-006` tenant-configurable statuses (`lead-statuses.js`)         |
| **CRM §4.1**           | `SW-CRM-005` Bulk API job path (`salesforce-service.js:203`) · `SW-CRM-006` incremental sync + archive-on-delete · `SW-CRM-008` gated write-back (`salesforce-writeback.js`)                                                                                                                                     |
| **CSV §4.2**           | `SW-CSV-001` 100k row cap · `SW-CSV-002` saved mapping templates (`CsvMappingTemplate`) · `SW-CSV-006` homeowner limits — 1,000 rows/file + 500 total (`csv.controller.js:166-190`)                                                                                                                              |
| **Nurture §4.3**       | `SW-NUR-001` 1–50 step cap enforced (`campaigns.controller.js:272`) · `SW-NUR-003` exit conditions incl. hardcoded appointment-exit · `SW-NUR-006` compliance gate on every step (`nurture.js:119`) incl. quiet-hours re-sleep · `SW-NUR-007` `versionPolicy` FINISH_OLD / MIGRATE                               |
| **Calendar §4.4**      | `SW-CAL-002` AI suggestions from tenant profile + news + seasonality · `SW-CAL-003` accept/edit/dismiss, with dismissals fed back into the prompt to shape ranking · `SW-CAL-005` status machine + non-editable terminal states                                                                                  |
| **Announcements §4.5** | `SW-ANN-002` audience snapshot + 50-chunk fan-out + per-tenant throttle · `SW-ANN-003` scheduled + cancelable (`cancelOn`) · `SW-ANN-004` state/city/zip targeting · `SW-ANN-005` per-chunk metric persistence · `SW-ANN-007` compliance gate                                                                    |
| **Scheduling §4.6**    | `SW-APT-002` both modes (SIMPLE link / AI agent) · `SW-APT-003` availability + Google Calendar busy/free · `SW-APT-004` booking record + confirmations + 24h/1h reminders · `SW-APT-005` reschedule/cancel via token · `SW-APT-007` atomic slot reservation via unique constraint → graceful re-offer on `P2002` |
| **News §4.7**          | `SW-NEWS-001` per-tenant sources · `SW-NEWS-003` AI summarize + attribution · `SW-NEWS-006` per-source failure isolation                                                                                                                                                                                         |
| **Blog §4.8**          | `SW-BLOG-002` brand voice + SEO + news citations · `SW-BLOG-004` human approval gate · `SW-BLOG-005` hosted blog + HTML/MD export                                                                                                                                                                                |
| **Automations §4.9**   | `SW-AMK-003` cooldown loop-prevention (`Automation.cooldownHours`, default 24) · `SW-AMK-004` **kill switch + per-tenant daily cap** (`Company.automationsKillSwitch` / `automationDailyCap`, `automations.controller.js:195`)                                                                                   |
| **KB §4.10**           | `SW-KB-001` PDF/DOCX/TXT upload + status feedback · `SW-KB-002` chunk→embed→index, tenant-scoped · `SW-KB-003` soft delete (drops vectors, keeps row) · `SW-KB-006` brand profile injected at runtime                                                                                                            |
| **NFR §5**             | `NFR-O-001` complaint-rate threshold + alert mailer · `NFR-R-002` announcement idempotency via timeline guard · `NFR-SC-002` per-tenant Inngest concurrency/throttle keys (dead-letter still open)                                                                                                               |

**Stack deviations from the SRS — working as intended, recorded so they aren't
re-raised as bugs:**

- **Vector store:** SRS §11.1 specifies Pinecone/Weaviate (configurable); we ship
  **pgvector in the existing Postgres** with an automatic full-text-search
  fallback. Cheaper and one less dependency.
  - ⚠️ **Retrieval degrades silently.** `queryDetailed` returns a `method`
    (`semantic` / `fts (no semantic match)` / `fts (semantic unavailable)`), but
    `query()` **discards it** — and `query()` is what `appointment.js:224` and
    `blog.controller.js:218` call. If pgvector isn't set up or embeddings fail, both
    features quietly fall back to keyword search with no signal. Worth surfacing
    `method` on the KB admin page (the `/kb/search` endpoint already returns it).
- **LLM:** SRS says Claude; `llm.js` is Anthropic-first with a **Groq/Llama
  fallback**. Provider-agnostic behind `chat()` / `toolCall()`, so it satisfies the
  "abstracted, swappable" intent — but a Groq fallback means a non-Claude model can
  serve live traffic. Confirm that's acceptable.

---

## 🏗️ Infrastructure & Security

- [ ] 🟡 **DB connection resilience.** The `pg` pool is hardened (keep-alive,
      longer connect timeout, dead-client eviction). Still worth doing:
  - [ ] A short retry-on-transient-error wrapper around auth's DB lookup.
  - [ ] Evaluate the transaction pooler (`:6543`) vs. the session pooler for this
        long-running server.
- [ ] 🔴 **`NFR-SC-002` — Tenant-scoped Inngest context.** Plus a dead-letter path
      for failed background jobs.
- [ ] 🟡 **`NFR-S-003` — Secrets / encryption at rest.**
  - [x] Salesforce **and** Google Calendar OAuth tokens are AES-256-GCM encrypted
        at rest; app fails closed in production if the default key is used
        (`server/src/lib/crypto.js`).
  - [ ] Set a strong `APP_ENCRYPTION_KEY` in production and re-encrypt any secrets
        written under the old default key (operational — see below).
  - [ ] Optional: move all provider secrets to a real secrets vault.
- [ ] 🔴 **Compliance & privacy.**
  - [ ] `NFR-S-008` — merge-field injection-safe rendering.
  - [ ] `NFR-S-007` — AI PII minimization.
  - [ ] `NFR-S-006` — **Uploaded CSVs are not virus-scanned, and there is no
        retention policy.** SRS: "Uploaded CSVs shall be virus-scanned and stored with
        limited retention (default 30 days post-import)." No scanner exists anywhere in
        `server/`, and nothing purges uploads after import. Decide: scan-on-upload
        (ClamAV or the storage provider's scanner) + a scheduled purge job, or record a
        signed-off de-scope.
  - [ ] `NFR-S-005` — GDPR / CCPA data export & delete.
  - [ ] `NFR-S-004` — Audit log (the `AuditLog` model + helper exist; confirm it's
        wired across the Sales mutations).

---

## ⚡ Performance & code quality (NFR-P / reusability)

- [ ] 🔴 **`NFR-P-002` — `getLeads` has no pagination.** `leads.controller.js` loads
      every matching lead and the leads page paginates client-side; this breaks the
      "<1s at 100k leads" target and ships large payloads. Needs server-side pagination
      + a leads-page pager. **Highest-impact perf item.**
- [ ] 🟡 **Reusable `requireCompany` guard.** The `if (!req.user?.companyId) return
      403` check is duplicated ~73× across controllers — fold into one middleware.
- [ ] 🟡 **Reminder-cron index.** `SalesAppointment` has no `(status, time)` index for
      the 15-min reminder query; add via `CREATE INDEX CONCURRENTLY` (not `db push`, to
      avoid a table lock).
- [ ] 🟡 **News summarization is sequential.** `news-service.js` awaits one LLM call
      per item in a loop; bounded-concurrency parallelization would cut scrape latency
      (mind provider rate limits).
- [ ] 🟡 **Frontend fetch waterfalls (`NFR-P-001`).** ~23 `useEffect` fetches across
      the sales/warranty pages; consider SWR/React Query or parallelizing initial loads.
- [ ] 🟡 **Surface retrieval `method` on the KB admin page** (see the Vector-store
      deviation note above) so a silent semantic→FTS fallback is visible.

---

## 🏢 Additional Client Requests (beyond the SRS)

- [ ] 🔴 **Literal payment / invoice gating.** Upload invoice, "clear invoices to
      proceed", auto-share invoice, welcome email after first invoice paid. The
      document-verification gate shipped instead (env-only super-admin login,
      `/admin` UI, welcome email on approval, gated by `Company.verificationStatus` —
      no Invoice/Payment model) — decide with the client whether real invoicing is
      still required.

---

## ⚙️ Operational steps (code done — run once per environment)

Not coding tasks; these activate finished features on a live database /
environment.

- [ ] 🚨 **Run the permissions backfill — in this order, or staff lose access.**
      `User.salesPermissions` defaults to `[]`, and a STAFF user with `[]` is denied all
      six gated features. **This is not theoretical:** this database has a live staff
      account (`staff@aiforhomebuilders.com`) whose permissions currently read `[]`, so
      it will be locked out of announcements, blog, automations, KB, campaigns and CSV
      from the moment the gates deploy until the backfill runs.
  ```bash
  npx prisma db push                                          # 1. add the column
  node server/scripts/backfill-sales-permissions.mjs          # 2. dry run — review
  node server/scripts/backfill-sales-permissions.mjs --apply  # 3. grant existing staff
  ```
  The backfill grants **existing** STAFF the full set, reproducing exactly the access
  they had before; admins then revoke downward, which is the safe direction. Staff
  created _after_ this still start with nothing — which is what §2.2's "per
  permissions granted by the Builder Admin" asks for. Re-running is safe: it only
  touches STAFF whose set is still empty, so it won't re-grant someone an admin has
  deliberately restricted.
- [ ] **Regenerate the Prisma client _for the `server/` package_.** ⚠️ Gotcha worth
      knowing: `server/` is a separate package with its **own** `@prisma/client` +
      `node_modules/.prisma/client`, and it is what the backend actually resolves at
      runtime. Because the schema lives at the repo root, `npx prisma generate` — run
      from the root _or_ from `server/` with `--schema ../prisma/schema.prisma` —
      always writes to the **root** client, leaving `server/`'s copy stale. A stale
      server client means `prisma.deadLetter` / `prisma.salesforceMappingVersion` are
      `undefined` at runtime and the new code throws. Until the generate step is fixed
      properly, sync it after every schema change:
  ```bash
  npx prisma generate
  cp -r node_modules/.prisma/client/. server/node_modules/.prisma/client/
  ```
  Worth fixing properly — a root `generate` silently not updating the backend's
  client is a trap that will bite again on the next schema change.
- [ ] **`prisma/pgvector-setup.sql`** then **`POST /api/sales/kb/reindex`** —
      enables pgvector semantic KB search. Until then, retrieval falls back to
      full-text search.
- [ ] **Set a strong `APP_ENCRYPTION_KEY`** in production. Fail-closed is now
      active, so production refuses to store integration secrets under the default
      key.

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
