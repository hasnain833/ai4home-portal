# Sales Workspace — Task Board

Tracks the **open** work for the Sales Workspace against the **Ai.Lumen Sales
Workspace SRS v1.1** (`sales-workspace-srs.pdf`). For the warranty side see
[`warranty-workspace.md`](./warranty-workspace.md).

_Last updated: 2026-07-17 (full SRS-vs-code re-audit)._

> **Runtime note** — Per SRS §11.4, the Sales AI features run on the native
> **Claude + Inngest** runtime. Botpress is the Warranty-workspace bot engine
> only.

### Legend

- `- [ ]` open task · `- [x]` done.
- 🔴 **Open** (not started) · 🟡 **Partial** (core works, gaps remain) · ⚙️ **Operational** (code done, one-time env/DB step pending) · ✅ **Done**.

---

## 📚 Sales KB & Brand Voice — `SW-KB` / `SW-AGT`

- [ ] 🟡 **`SW-KB-002` — RAG coverage: 2 of the 5 SRS-named AI features use the
      KB.** SRS §4.10 names _nurture content assist, calendar suggestions, the
      scheduling agent, the news summarizer, and the blog drafter_ as KB consumers
      ("Indexed content shall be retrievable by the Sales AI features at generation
      time"). `vector-store.service.js` is imported in only four files — `blog.controller.js`,
      `appointment.js`, `kb.controller.js` (the admin/search endpoint) and
      `kb-ingest.js`. So only the **blog drafter** and **scheduling agent** are
      grounded. Not wired:
  - [ ] **Nurture content assist** — `generateCampaignCopy`
        (`campaigns.controller.js:781`) injects the brand profile but never calls
        `kbQuery`; drafts are ungrounded.
  - [ ] **Calendar suggestions** — `getCalendarSuggestions`
        (`calendar.controller.js:267`) is grounded in tenant profile + news +
        seasonality only, no KB.
  - [ ] News summarizer — arguably fine ungrounded; confirm intent and either
        wire it or record the de-scope.
- [ ] 🔴 **`SW-KB-004` — Category scoping is never applied.** Documents are
      taggable, and `queryDetailed(companyId, q, k, categories)`
      (`vector-store.service.js:71`) supports the filter — but **no caller passes
      it**: `appointment.js:224` and `blog.controller.js:218` both call
      `kbQuery(companyId, q, 5)`. Every feature therefore searches the whole
      collection. SRS wants the scheduling agent scoped to FAQs/policy and the blog
      drafter to brand voice/product info. The plumbing exists; only the call sites
      need the argument.
- [ ] 🟡 **`SW-KB-005` — Blog drafts don't record KB citations.** The scheduling
      agent does (`appointment.js:317-321` → `kbCitations` on the timeline). The blog
      drafter builds `citations` from **`ScrapedNews` only** (`blog.controller.js:224-229`);
      `kbChunks` are fed into the prompt at line 218 but never recorded, so a draft
      grounded in KB docs shows no KB provenance. SRS requires citation capture for
      "blog drafts, scheduling-agent answers, nurture content".
- [ ] 🟡 **`SW-AGT-001` — Agent runtime abstraction.** Retrieval is a clean,
      reusable service (`vector-store.service.js`). Remaining work is wiring the
      unwired consumers above, plus any new ones.
- [ ] 🔴 **`SW-KB-007` — Config safety.** Prompt-affecting config (brand profile,
      agent toggles) is **not versioned with rollback**, and there is **no
      preview/sandbox mode** to test AI behaviour before it affects live sends.

---


---

## 🧩 Cross-cutting SRS Coverage
  - [ ] 🟡 **Still open: Homeowner "limited templates"** (matrix: nurture sequences
        = "Yes (limited templates)"). The SRS never defines what limits a template, so
        there's nothing to implement against. Needs a product definition before it can
        be built — deliberately not invented here.
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

## 🏢 Additional Client Requests (beyond the SRS)

- [ ] 🔴 **Literal payment / invoice gating.** Upload invoice, "clear invoices to
      proceed", auto-share invoice, welcome email after first invoice paid. The
      document-verification gate shipped instead (env-only super-admin login,
      `/admin` UI, welcome email on approval, gated by `Company.verificationStatus` —
      no Invoice/Payment model) — decide with the client whether real invoicing is
      still required.

---

## 📰 News & Blog distribution

- [x] ✅ **`SW-NEWS-001` — Per-tenant news sources** ⚙️ _(code done 2026-07-16;
      needs `prisma db push` — see Operational steps)._ The old scraper fetched **one
      hard-coded Google News RSS feed** and cloned identical articles to every
      sales-enabled company. Now tenant-configurable:
  - [x] `Company.newsSources` field + validation/normalization
        (`server/src/lib/news-sources.js`).
  - [x] Scraper iterates each tenant's sources with per-source failure isolation
        (`SW-NEWS-006`) and a platform-default fallback
        (`server/src/services/news-service.js`, `news-scraper.js`).
  - [x] Settings UI to manage feeds (`NewsSourcesTab` in `/sales/settings`).
  - [x] On-demand "fetch latest" refresh (`POST /api/sales/news/refresh`) on the
        settings tab and the News page.
- [x] ✅ **`SW-BLOG-005` — Blog output targets** _(verified 2026-07-16)._
      Everything the SRS literally requires is done: publish to the workspace-hosted
      per-tenant blog page (`/blog/[companyId]`, reads via `/api/public/blog/...`;
      `/blog` is now on the middleware public-route allowlist so anonymous readers
      can reach it) and export as **HTML/Markdown**. Sample data seeder:
      `server/scripts/seed-blog.mjs`.
  - De-scoped per client (2026-07-16): Strapi-style embeddable widget /
    CORS-enabled headless content API, and the SRS "should-have" **direct
    WordPress integration** — not building these.

---

## ⚙️ Operational steps (code done — run once per environment)

Not coding tasks; these activate finished features on a live database /
environment.

- [ ] **`prisma db push`** — applies pending additive schema changes: new
      `Company` columns for tenant-configurable lead statuses + SMS quiet hours +
      **per-tenant `newsSources` (`SW-NEWS-001`)**; the `BlogPost` table; drops the
      removed `ScrapedNews.wasBroadcasted` column; the `AuditLog` table; and (added
      2026-07-17) the **`SalesforceMappingVersion`** (`SW-CRM-004`) and **`DeadLetter`**
      (`SW-ANN-002`) tables.
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

## 🗒️ De-scoped (per client, not building)

- [x] **News / Nurture auto-share** — no auto-campaign; the manual flow (create a
      campaign, then launch it) is built and is the intended process.
- [x] **Shared notification center** (`HUB-007`) — not required.
- [x] **Announcement image editor & radius/geo targeting** — not required.
- [x] **Per-timezone quiet-hours auto-requeue** — replaced by tenant-configurable
      quiet hours + admin-set send time.

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
