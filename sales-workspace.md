# AI4Home Warranty Care Portal — Sales Workspace (Remaining Work)

Tracks the **remaining** Sales Workspace work against the **Ai.Lumen Sales Workspace SRS v1.1** (`sales-workspace-srs.pdf`). Completed items have been removed — only open (`[ ]`) and partial (`[~]`) work is listed. _(Last pruned 2026-07-09.)_

> **Runtime note:** Per SRS §11.4, the Sales AI features run on the **native Claude + Inngest** runtime (not Botpress). Botpress remains the Warranty-workspace bot engine only — see [warranty-workspace.md].

## 🧱 0. Foundation — Workspace Hub & Lead Model
> **Entitlements (HUB-003/009) — now enforced server-side (2026-07-09):** added `requireWorkspace("sales")` (auth.js) and applied it to every private `/api/sales/*` router at mount (`index.js`), plus per-route on the mixed routers (`salesforce`/`appointments`/`scheduling`) that also expose public lead-facing endpoints. `requireAuth` now computes **effective** access (admins/staff implicit, gated by company `salesEnabled`/`warrantyEnabled`, Super Admin bypass) and short-circuits when a mount-level guard already authed. So a user without Sales access gets a **403 from the API**, not just a hidden UI.
- [~] **Deduplication (SW-LEAD-003)**: normalized dedup now shared across manual bulk import + CSV import via `lib/lead-dedup.js` — **case-insensitive email, then phone by last-10-digits** (ignoring formatting on both sides). **Remaining:** **cross-source linking** (same lead from Salesforce + CSV, CRM as system-of-record) is still not implemented.
- [~] **Lead lifecycle statuses (SW-LEAD-006)**: default status set + manual/automation transitions work; Salesforce deletions now archive the local lead (SW-CRM-006, done). **Remaining:** statuses are **not tenant-configurable** (hardcoded set).
- [ ] **Notification routing (HUB-007)**: workspace-tagged notifications with deep-links in a shared notification center — not built.

## 🤖 1. Nurture Agent (SW-NUR)
- [~] **Remaining polish**: front-end UI to *edit* exit-conditions / version-policy / segment-enroll (backend + API done; wire the campaign settings panel); confirm delivered/opened/clicked populate from the live Brevo webhook; full mid-run MIGRATE (in-flight Inngest runs finish their loaded step list).

## 🤖 3. Content Calendar (SW-CAL)
> Month / Week / List views (SW-CAL-001), drag-and-drop reschedule (SW-CAL-004), and tenant-profile + seasonal AI-suggestion inputs (SW-CAL-002) are now built. Scheduled/sent **announcements** are surfaced as first-class calendar items.
- [~] **Blog items on the calendar (SW-CAL-001)**: blogs are still **not** surfaced as calendar items — blocked by the missing SW-BLOG backend (§8). Wire once blog drafts have a schedulable model.

## 🤖 4. Announcements Agent (SW-ANN)
- [ ] **Deferred to v2**: rich-text/image editor, radius geo-targeting, dead-letter queue surfacing in UI, per-timezone SMS quiet-hours deferral (blocked-by-quiet-hours SMS are currently skipped, not requeued).

## 🤖 5. CRM Sync Agent (SW-CRM)
> **Built out 2026-07-09.** The incremental sync core moved to `services/salesforce-sync.js` (shared by the manual endpoint + the new cron).
> - **SW-CRM-006 — scheduled sync + deletion archive:** `inngest/functions/salesforce-cron.js` runs every 15 min and syncs each active connection when due per its `syncInterval`. Salesforce deletions are reconciled via `queryAll (IsDeleted = true)` → the local lead is set `archived` (`Lead.archived`/`archivedAt`; hidden from the leads list unless `?includeArchived=true`).
> - **SW-CRM-007 — rate limit & backoff:** `SalesforceClient.apiRequest` retries 429/5xx with exponential backoff + jitter, honoring `Retry-After`; 4xx fail fast. Per-record errors are collected (partial-failure safe) and surfaced in the SyncLog.
> - **SW-CRM-008 — write-back:** `services/salesforce-writeback.js` pushes lead **status / consent** changes back to Salesforce, **off by default** behind `SalesforceConnection.writeBackEnabled` (toggle via `PATCH /salesforce/status`), only for leads with an `externalId`. Hooked into `updateLead`. Logs OUTBOUND SyncLog rows.
> - **SW-CRM-009 — consent on import:** verified — imported leads default to opt-ins `false` / `consentSource = "Salesforce (consent unknown)"` unless SF maps a consent field, so they're excluded from opt-in-required sends by the compliance gate.
- [ ] **Write-back coverage (SW-CRM-008, extend)**: also push **appointment-booked** and dedicated **unsubscribe** events (currently status + consent via `updateLead` only); add a Settings UI toggle for `writeBackEnabled`.
- [ ] **Persistent-failure alerting (SW-CRM-007, extend)**: surface repeated sync/write-back failures as an admin notification (depends on the HUB-007 notification center), not just SyncLog rows.

## 🤖 7. News Scraping Agent (SW-NEWS)
> Flow confirmed correct (2026-07-09): the scraper **never broadcasts on its own** — a human clicks "Create Campaign" on a news item and manually launches it. The generated campaign is now **immediate** (the 2-day wait step was removed) and its email/SMS copy is AI-written via the shared LLM helper with a clean, non-duplicating fallback template.
- [~] **Consumption follow-ups**: news feeds the Market News feed + calendar suggestions (consumption-only). **Open:** the dead `ScrapedNews.wasBroadcasted` column should be dropped in a later migration; blog drafter consumption depends on the unbuilt SW-BLOG backend (§8).

## 🤖 8. Blog Drafting Agent (SW-BLOG) — frontend only, no backend
> Frontend page exists (`sales/blog`) with an empty state; **no backend model, API, route, or Inngest pipeline** yet. Biggest remaining feature gap.
- [ ] **News-to-draft pipeline (SW-BLOG-001)**: Claude generates draft.
- [ ] **Brand voice RAG (SW-BLOG-002)**: pull brand profile + KB documents.
- [ ] **Human approval gate (SW-BLOG-004)**: explicit approval required.
- [ ] **Publish/export (SW-BLOG-005)**.
- [ ] **Calendar integration (SW-BLOG-006)**.

## 🤖 9. Automated Marketing Rules Agent (SW-AMK)
- [~] **Remaining polish**: `send single email/SMS`, `create task`, `draft announcement` actions and `APPOINTMENT_BOOKED`/date-based triggers (SRS "should-haves") not yet wired; daily-cap enforcement is stored but not yet counted against sends; analytics UI panel (data + endpoint exist).

## 🤖 10. Sales KB & Brand Voice Agent (SW-KB / SW-AGT)
> **Migrated off Pinecone/OpenAI embeddings (2026-07-09, team decision):** no external vector DB or embeddings. The KB is now stored as plain text chunks in **Supabase Postgres** (`SalesKBChunk`) and retrieved via **Postgres full-text search** (`to_tsvector` / `websearch_to_tsquery` → OR-converted → `ts_rank`), backed by a GIN index. `vector-store.service.js` keeps the same `upsertChunks` / `query` / `deleteDocument` interface, so the ingester and appointment agent were unchanged apart from dropping the config/score gates. **No API keys required — works out of the box.** Chat memory was already in Supabase (`SchedulingConversation.transcript`).
- [~] **Retrieval quality tradeoff**: FTS is **keyword** matching, not semantic — synonyms/paraphrases the doc doesn't contain won't match (e.g. "pricing" won't hit a chunk that only says "cost"). Good enough for factual FAQ lookups; revisit embeddings/pgvector later if semantic recall becomes necessary.
- [~] **Agent runtime abstraction (SW-AGT-001)**: retrieval is a clean service (`vector-store.service.js`) any AI feature can call; consumers (blog drafter, nurture assist) wire it as they're built.

## 📊 11. Workspace Dashboard & Reporting (SW-DSH)
- [~] **Dashboard completeness (SW-DSH-001)**: SRS also requires **active sequences/campaigns with key metrics** (only a raw *count* is shown) and **upcoming calendar items** (not surfaced). Fill these in for full compliance.
- [~] **CSV export (SW-DSH-002)**: `exportDashboardCsv` exports **leads only**. SRS requires **all reporting views** exportable (campaign/announcement/automation analytics have no CSV export path). Wire CSV export for the remaining reports.

## 🧩 12. Cross-cutting SRS coverage (Role matrix, Config safety, Agent runtime)
- [~] **Role-to-Feature Matrix (§4.12)**: RBAC exists (ADMIN/STAFF/HOMEOWNER). **Not fully mapped:** Builder-Member "per-permission" granularity, homeowner "own leads / limited templates" scoping, and Platform-Admin views. Audit each Sales route against the matrix.
- [ ] **KB / config safety (SW-KB-007)**: prompt-affecting config (brand profile, agent toggles) is **not versioned with rollback**, and there is **no preview/sandbox mode** to test AI behaviour before it affects live sends.
- [~] **Agent runtime abstraction (SW-AGT-001 / SW-AGT-002)**: Sales AI runs on Claude + Inngest. KB retrieval no longer uses embeddings or an external vector DB — it's Postgres full-text search (§10), so there's no separate embedding provider to reconcile.

## 🏗️ Cross-cutting Infrastructure & Security
- [~] **DB connection resilience**: the `pg` pool is hardened (`keepAlive`, longer connect timeout, dead-client eviction) against the Supabase session pooler dropping idle connections. **Still worth doing:** a short retry-on-transient-connection-error wrapper around auth's DB lookup, and/or evaluate the transaction pooler (`:6543`) vs. session pooler for this long-running server.
- [ ] **Tenant-scoped Inngest context** (NFR-SC-002) + Dead-letter.
- [ ] **Secrets vault** (NFR-S-003).
- [ ] **Audit log table** (NFR-S-004).
- [ ] **GDPR/CCPA export/delete** (NFR-S-005).
- [ ] **Merge-field injection-safe rendering** (NFR-S-008).
- [ ] **AI PII minimization** (NFR-S-007).
- [~] **LLM provider config**: `ANTHROPIC_API_KEY` in `server/.env` is still the **placeholder** (`your_...`), so direct Claude calls auth-fail. A **Groq** key is present in `OPENAI_API_KEY` (`gsk_...`). Campaign copy (news + nurture assist) now goes through the shared `server/src/lib/llm.js` helper, which prefers a real Anthropic key (`sk-ant-`) and otherwise falls back to Groq — so those work today. **Still on the raw Anthropic key (will fail until a real key is set OR they're migrated to `llm.js`):** the appointment agent (`appointment.js`), calendar suggestions (`calendar.controller.js`), and news-scraper summarization (`news-scraper.js`). (The KB no longer needs OpenAI/embeddings — see §10.)

## 🏢 Additional client requests (beyond the SRS)
> The Super Admin portal + tenant document-verification gate are **built** (env-only super-admin login, `/admin` UI, `verifyCompany` which also sends the tenant an activation/welcome email on approval, `VerificationGate.tsx`). Gating is driven by `Company.verificationStatus`, not invoices — there is **no** Invoice/Payment/Subscription model. Remaining:
- [ ] **Literal payment/invoice gating** (upload invoice, "clear invoices to proceed", auto-share invoice, welcome email after first invoice paid): **not built**. The document-verification gate shipped instead. Decide with the client whether real invoicing is still required.
- [ ] **Terms of Service + Privacy Policy pages** — still none under `src/app`.
- [ ] **Nurture Agent auto-share** of news, mortgage rates, and home-pricing updates using blog-scraper content. (Depends on SW-BLOG backend, §8.)


## ⏰ Deadline tracker — features due **10 July**
- [~] **AI Content Calendar** — functional: Month/Week/List views, drag-and-drop reschedule, tenant-profile + seasonal AI inputs, and announcements as calendar items are all done. **Only remaining:** surface blog drafts as items (blocked by the SW-BLOG backend, §8). See §3.
- [ ] **Blog Scraper / Blog Drafting (SW-BLOG)** — frontend-only, no backend (no model/API/Inngest pipeline). Biggest remaining gap for the deadline. See §8.
