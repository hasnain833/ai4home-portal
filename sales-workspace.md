# AI4Home Warranty Care Portal — Sales Workspace (Remaining Work)

Tracks the **remaining** Sales Workspace work against the **Ai.Lumen Sales Workspace SRS v1.1** (`sales-workspace-srs.pdf`). Completed items have been removed — only open (`[ ]`) and partial (`[~]`) work is listed. _(Last pruned 2026-07-09.)_

> **Runtime note:** Per SRS §11.4, the Sales AI features run on the **native Claude + Inngest** runtime (not Botpress). Botpress remains the Warranty-workspace bot engine only — see [warranty-workspace.md].

## 🧱 0. Foundation — Workspace Hub & Lead Model

> **Entitlements (HUB-003/009) — now enforced server-side (2026-07-09):** added `requireWorkspace("sales")` (auth.js) and applied it to every private `/api/sales/*` router at mount (`index.js`), plus per-route on the mixed routers (`salesforce`/`appointments`/`scheduling`) that also expose public lead-facing endpoints. `requireAuth` now computes **effective** access (admins/staff implicit, gated by company `salesEnabled`/`warrantyEnabled`, Super Admin bypass) and short-circuits when a mount-level guard already authed. So a user without Sales access gets a **403 from the API**, not just a hidden UI.

- [~] **Deduplication (SW-LEAD-003)**: normalized dedup now shared across manual bulk import + CSV import via `lib/lead-dedup.js` — **case-insensitive email, then phone by last-10-digits** (ignoring formatting on both sides). **Remaining:** **cross-source linking** (same lead from Salesforce + CSV, CRM as system-of-record) is still not implemented.
- [~] **Lead lifecycle statuses (SW-LEAD-006)**: default status set + manual/automation transitions work; Salesforce deletions now archive the local lead (SW-CRM-006, done). **Remaining:** statuses are **not tenant-configurable** (hardcoded set).
- [ ] **Notification routing (HUB-007)**: workspace-tagged notifications with deep-links in a shared notification center — not built.

## 🤖 1. Nurture Agent (SW-NUR) — ✅ polish completed 2026-07-10

- [x] **Campaign settings UI (SW-NUR-003 / 007)**: added a **Settings** panel on the campaigns page (`sales/campaigns`) to edit **exit conditions** (on reply / on appointment / on status-change → a chosen status) and **version policy** (Finish-old vs Migrate), persisted via `PUT /api/sales/campaigns/:id` (`exitConditions` JSON + `versionPolicy`). Panel init is keyed on campaign id so the 3s poll doesn't clobber edits.
- [x] **Segment enrollment (SW-NUR-002)**: the Enroll modal now has a **"By Segment"** mode — pick a saved segment and enroll every matching lead via `POST /:id/enroll { segmentId }` (evaluated at send time; already-active leads skipped).
- [x] **Delivered/opened/clicked from the live Brevo webhook (SW-NUR-008)**: verified the webhook path (`processBrevoEmailEvents` → `ComplianceService.handleMessageEvent`) increments `deliveredCount`/`openedCount`/`clickedCount`/`bouncedCount`/`complaintCount` on the step by the provider tag (= `CampaignStep.id`, sent as `X-Mailin-Tag`). **Fixed** `getCampaignDetail` to surface those real columns instead of deriving `delivered` from `sent`.
- [x] **Full mid-run MIGRATE (SW-NUR-007)**: `runNurtureCampaign` now **re-reads the step list at the top of every iteration when `versionPolicy === "MIGRATE"`**, so in-flight runs pick up edits to an active campaign (already-executed positions stay memoized by their durable `send-step-<pos>` ids; only not-yet-reached steps use new content). FINISH_OLD keeps the steps loaded at run start.


## 🤖 4. Announcements Agent (SW-ANN)

- [ ] **Deferred to v2**: rich-text/image editor, radius geo-targeting, dead-letter queue surfacing in UI, per-timezone SMS quiet-hours deferral (blocked-by-quiet-hours SMS are currently skipped, not requeued).

## 🤖 5. CRM Sync Agent (SW-CRM)

> **Built out 2026-07-09.** The incremental sync core moved to `services/salesforce-sync.js` (shared by the manual endpoint + the new cron).
>
> - **SW-CRM-006 — scheduled sync + deletion archive:** `inngest/functions/salesforce-cron.js` runs every 15 min and syncs each active connection when due per its `syncInterval`. Salesforce deletions are reconciled via `queryAll (IsDeleted = true)` → the local lead is set `archived` (`Lead.archived`/`archivedAt`; hidden from the leads list unless `?includeArchived=true`).
> - **SW-CRM-007 — rate limit & backoff:** `SalesforceClient.apiRequest` retries 429/5xx with exponential backoff + jitter, honoring `Retry-After`; 4xx fail fast. Per-record errors are collected (partial-failure safe) and surfaced in the SyncLog.
> - **SW-CRM-008 — write-back:** `services/salesforce-writeback.js` pushes lead **status / consent** changes back to Salesforce, **off by default** behind `SalesforceConnection.writeBackEnabled` (toggle via `PATCH /salesforce/status`), only for leads with an `externalId`. Hooked into `updateLead`. Logs OUTBOUND SyncLog rows.
> - **SW-CRM-009 — consent on import:** verified — imported leads default to opt-ins `false` / `consentSource = "Salesforce (consent unknown)"` unless SF maps a consent field, so they're excluded from opt-in-required sends by the compliance gate.

- [ ] **Write-back coverage (SW-CRM-008, extend)**: also push **appointment-booked** and dedicated **unsubscribe** events (currently status + consent via `updateLead` only); add a Settings UI toggle for `writeBackEnabled`.
- [ ] **Persistent-failure alerting (SW-CRM-007, extend)**: surface repeated sync/write-back failures as an admin notification (depends on the HUB-007 notification center), not just SyncLog rows.

## 🤖 7. News Scraping Agent (SW-NEWS)

> Flow confirmed correct (2026-07-09): the scraper **never broadcasts on its own** — a human clicks "Create Campaign" on a news item and manually launches it. The generated campaign is now **immediate** (the 2-day wait step was removed) and its email/SMS copy is AI-written via the shared LLM helper with a clean, non-duplicating fallback template.

- [~] **Consumption follow-ups**: news feeds the Market News feed + calendar suggestions (consumption-only). The dead `ScrapedNews.wasBroadcasted` column is now removed from the schema/code (2026-07-10; run `prisma db push` to drop it on the live DB). **Open:** blog drafter consumption depends on the unbuilt SW-BLOG backend (§8).

## 🤖 8. Blog Drafting Agent (SW-BLOG) — ✅ BUILT 2026-07-10 (backend + real UI)

> **Fully implemented end-to-end.** New `BlogPost` model + `BlogStatus` enum (schema), `blog.controller.js` (14 endpoints), private router `/api/sales/blog` (ADMIN/STAFF, behind the sales guard) and public router `/api/public/blog` (unguarded reads). The frontend `sales/blog` page was **rewritten off the mock** onto the real API (list/create/edit/delete, AI generate, approve, publish, export, schedule), and a public tenant-hosted reader lives at `/blog/[companyId]` + `/blog/[companyId]/[slug]`. `tsc` clean.
> ⚙️ **One operational step:** run `prisma db push` to create the `BlogPost` table on the live DB (additive) — until then the endpoints 500.

- [x] **News-to-draft pipeline (SW-BLOG-001)**: `POST /generate` — user picks a topic (+ optional market-news items to cite); Claude/Groq via `llm.js` writes the draft. Full lifecycle DRAFT → PENDING_REVIEW → APPROVED → SCHEDULED/PUBLISHED.
- [x] **Brand voice RAG (SW-BLOG-002)**: generation grounds on `Company.salesBrandProfile`/`voiceProfile` **and** KB full-text retrieval (`vector-store.query`); emits SEO fields (metaTitle/metaDescription/headings) and explicit source **citations** from the selected news items. Section-level AI regeneration (`/:id/regenerate-section`) preserves manual edits elsewhere (SW-BLOG-003).
- [x] **Human approval gate (SW-BLOG-004)**: publish **and** export are blocked unless `approvedAt` is set; editing an approved/published post reverts it to PENDING_REVIEW. AI drafts are labeled in the UI.
- [x] **Publish/export (SW-BLOG-005)**: `POST /:id/publish` (assigns a unique slug, exposes it on the public blog) and `GET /:id/export?format=md|html` (YAML front-matter Markdown or injection-safe HTML).
- [x] **Calendar integration (SW-BLOG-006)**: `POST /:id/schedule` creates a `ContentCalendar` item (channel `Blog`) linked back to the post — so it surfaces on the content calendar (see §3).

## 🤖 9. Automated Marketing Rules Agent (SW-AMK)

- [~] **Remaining polish**: `send single email/SMS`, `create task`, `draft announcement` actions and `APPOINTMENT_BOOKED`/date-based triggers (SRS "should-haves") not yet wired; daily-cap enforcement is stored but not yet counted against sends; analytics UI panel (data + endpoint exist).

## 🤖 10. Sales KB & Brand Voice Agent (SW-KB / SW-AGT)

> **Upgraded to pgvector semantic search (2026-07-10) — no external/paid embedding provider.** `embedding.service.js` runs **`@xenova/transformers` all-MiniLM-L6-v2** locally (ONNX on CPU) to produce **384-dim** vectors with zero API cost (verified: loads and embeds real text). `vector-store.service.js` now does **pgvector cosine search** (`1 - (embedding <=> $1::vector)`, threshold ≥ 0.3) as the primary path and **falls back to the previous Postgres FTS** when embeddings are missing or pgvector isn't set up — so it never hard-fails. `POST /api/sales/kb/reindex` backfills embeddings for pre-upgrade chunks (batched; call until `remaining=0`). Same `upsertChunks`/`query`/`deleteDocument` interface, so consumers (appointment agent, blog drafter) were unchanged.
> ⚠️ **One-time setup required (the pgvector half is inert until done):** `db push` cannot create the extension, so run **`prisma/pgvector-setup.sql`** once (Supabase SQL editor or `psql`) to `CREATE EXTENSION vector` + add the `embedding vector(384)` column + ivfflat index, then hit `/reindex`. Until then, retrieval silently uses FTS. On serverless (Vercel) the model cache is pointed at `/tmp` so the download works there too.

- [x] **Retrieval quality (SW-KB-002) — semantic search implemented 2026-07-10.** pgvector cosine over local MiniLM embeddings now catches synonyms/paraphrases FTS missed (e.g. "pricing" ↔ "cost"); FTS remains the graceful fallback. Verified end-to-end on the embedding side (model loads, 384-dim output); the DB query path is standard pgvector and activates after `pgvector-setup.sql` + `/reindex`.
- [~] **Agent runtime abstraction (SW-AGT-001)**: retrieval is a clean service (`vector-store.service.js`) any AI feature can call; consumers (blog drafter, nurture assist) wire it as they're built.

## 📊 11. Workspace Dashboard & Reporting (SW-DSH)

- [~] **Dashboard completeness (SW-DSH-001)**: SRS also requires **active sequences/campaigns with key metrics** (only a raw _count_ is shown) and **upcoming calendar items** (not surfaced). Fill these in for full compliance.
- [~] **CSV export (SW-DSH-002)**: `exportDashboardCsv` exports **leads only**. SRS requires **all reporting views** exportable (campaign/announcement/automation analytics have no CSV export path). Wire CSV export for the remaining reports.

## 🧩 12. Cross-cutting SRS coverage (Role matrix, Config safety, Agent runtime)

- [~] **Role-to-Feature Matrix (§4.12)**: RBAC exists (ADMIN/STAFF/HOMEOWNER). **Not fully mapped:** Builder-Member "per-permission" granularity, homeowner "own leads / limited templates" scoping, and Platform-Admin views. Audit each Sales route against the matrix.
- [ ] **KB / config safety (SW-KB-007)**: prompt-affecting config (brand profile, agent toggles) is **not versioned with rollback**, and there is **no preview/sandbox mode** to test AI behaviour before it affects live sends.
- [~] **Agent runtime abstraction (SW-AGT-001 / SW-AGT-002)**: Sales AI runs on Claude + Inngest. KB retrieval uses **pgvector semantic search over local (in-process) MiniLM embeddings, with Postgres FTS as fallback** (§10) — no external/paid embedding provider or separate vector DB to reconcile.

## 🏗️ Cross-cutting Infrastructure & Security

- [~] **DB connection resilience**: the `pg` pool is hardened (`keepAlive`, longer connect timeout, dead-client eviction) against the Supabase session pooler dropping idle connections. **Still worth doing:** a short retry-on-transient-connection-error wrapper around auth's DB lookup, and/or evaluate the transaction pooler (`:6543`) vs. session pooler for this long-running server.
- [ ] **Tenant-scoped Inngest context** (NFR-SC-002) + Dead-letter.
- [~] **Secrets vault / encryption at rest** (NFR-S-003): **partial.** Salesforce `accessToken`/`refreshToken`/`clientSecret` **are** AES-256-GCM encrypted at rest (`salesforce-service.js` `encrypt()`/`decrypt()`) ✅. **Gaps:** (a) the AES key `SALESFORCE_ENCRYPTION_KEY` has a public hardcoded fallback and is **currently the default value in `server/.env`** — encryption is effectively worthless until a strong key is set + stored tokens re-encrypted (a runtime warning now fires; see Technical Audit); (b) `CalendarConnection` Google OAuth `accessToken`/`refreshToken` are stored **plaintext** (`google-calendar.service.js`). Encrypt the calendar tokens too, or move all provider secrets to a real vault.
- [ ] **Audit log table** (NFR-S-004).
- [ ] **GDPR/CCPA export/delete** (NFR-S-005).
- [ ] **Merge-field injection-safe rendering** (NFR-S-008).
- [ ] **AI PII minimization** (NFR-S-007).
- [x] **LLM provider config — UNIFIED 2026-07-10.** **All** AI features now route through the shared `server/src/lib/llm.js` helper (prefers a real Anthropic `sk-ant-` key, otherwise falls back to Groq). The three former hold-outs — appointment agent (`appointment.js`, via the new `toolCall()`), calendar suggestions (`calendar.controller.js`), news-scraper summarization (`news-scraper.js`) — no longer use the raw Anthropic SDK, so they work on the Groq fallback today even while `ANTHROPIC_API_KEY` is a placeholder. Default model bumped to `claude-sonnet-4-6`. (KB needs no embeddings — see §10.)

## 🏢 Additional client requests (beyond the SRS)

> The Super Admin portal + tenant document-verification gate are **built** (env-only super-admin login, `/admin` UI, `verifyCompany` which also sends the tenant an activation/welcome email on approval, `VerificationGate.tsx`). Gating is driven by `Company.verificationStatus`, not invoices — there is **no** Invoice/Payment/Subscription model. Remaining:

- [ ] **Literal payment/invoice gating** (upload invoice, "clear invoices to proceed", auto-share invoice, welcome email after first invoice paid): **not built**. The document-verification gate shipped instead. Decide with the client whether real invoicing is still required.
- [ ] **Terms of Service + Privacy Policy pages** — still none under `src/app`.
- [ ] **Nurture Agent auto-share** of news, mortgage rates, and home-pricing updates using blog-scraper content. (Depends on SW-BLOG backend, §8.)

## 🔎 Technical Audit (2026-07-10)

> Code-level review of the current `dev-hasnain` branch against the SRS. `npx tsc --noEmit` **passes clean**. Findings below are ordered by severity; ✅ marks things verified as _correct_ (recorded so they aren't re-flagged).

## ⏰ Deadline tracker — features due **10 July**

- [x] **AI Content Calendar** — functional: Month/Week/List views, drag-and-drop reschedule, tenant-profile + seasonal AI inputs, announcements **and now scheduled blog posts** as calendar items (§3). Done.
- [x] **Blog Scraper / Blog Drafting (SW-BLOG)** — ✅ **BUILT 2026-07-10**: full backend (model + 14 endpoints + public reader) and a real (no-longer-mocked) UI covering SW-BLOG-001→006. See §8. ⚙️ Needs one `prisma db push` to activate the `BlogPost` table.
