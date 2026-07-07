# AI4Home Warranty Care Portal — Sales Workspace 

This document serves as the single, authoritative checklist and status tracker for the Sales Workspace backend functionality and agents. It maps directly to the **Ai.Lumen Sales Workspace SRS v1.1**. Legend: `[x]` done · `[~]` partial / needs verification · `[ ]` not started.

> **Runtime note:** Per SRS §11.4, the Sales scheduling agent ships on the **native Claude + Inngest** runtime (not Botpress). Botpress remains the Warranty-workspace bot engine only — see [warranty-workspace.md]. All Sales AI features run as Inngest + Claude pipelines.

## 🧱 0. Foundation — Workspace Hub & Lead Model (SRS §3, §4.0)
> Coexistence shell + canonical Lead entity that every Sales module depends on.
- [x] **Workspace hub / switcher (HUB-001/002/005)**: Hub landing at `src/app/hub/page.tsx` with workspace selection; `/warranty/...` and `/sales/...` route prefixes exist.
- [x] **Lead data model (SW-LEAD-001)**: `Lead`, `LeadTimeline`, `LeadSegment`, `SuppressionList` models present with source/consent fields.
- [x] **Activity timeline (SW-LEAD-005)**: `LeadTimeline` records messaging/enrollment/sync events.
- [x] **Segments (SW-LEAD-004)**: `LeadSegment` model + `/api/sales/segments`.
- [ ] **Entitlements / feature flag (HUB-003/009)**: Confirm per-tenant Sales entitlement gating (hub shows Lock icon) is enforced server-side and behind a per-tenant flag, not just UI.
- [ ] **Deduplication (SW-LEAD-003)**: Confirm email→phone match keys + per-import merge strategy (skip/update/create) on both CSV and CRM ingestion.
- [ ] **Last-workspace memory + notification routing (HUB-006/007)**.

## 🤖 1. Nurture Agent (SW-NUR) — ✅ core complete
> Executes multi-step drip campaigns, ensuring compliant delivery and recording timeline events. **Campaigns are one-time** (the "Restart"/relaunch reset was removed — a completed lead is not re-run).
- [x] **Sequence builder (SW-NUR-001)**: EMAIL/SMS/DELAY steps, delay + send-window, subject/body; merge fields `{firstName} {lastName} {email} {phone} {city} {companyName} {bookingLink}`; **1–50 step** bound enforced.
- [x] **Enrollment (SW-NUR-002)**: manual single/**bulk** + **enroll by saved segment** (`enroll` accepts `segmentId` → resolves filters to leads); duplicate-enrollment prevention; concurrent-enrollment warning.
- [x] **Exit conditions (SW-NUR-003)**: **per-sequence configurable** via `Campaign.exitConditions` (`onReply`, `onAppointment`, `onStatusChange`); unsubscribe/bounce/complaint always exit; **manual removal** endpoint (`/:id/unenroll`); status-change exits wired from `updateLead`. `handleCampaignExit` honours each sequence's config.
- [x] **Reply detection (SW-NUR-004)**: email+SMS webhooks → timeline → exit → appointment flow. Per-channel skip so single-channel leads aren't dropped.
- [x] **AI content assist (SW-NUR-005)**: `generateCampaignCopy` (Claude) now grounded in the tenant's **brand profile** (`salesBrandProfile` + `voiceProfile`, SW-KB-006); human-approved before send.
- [x] **Compliance (SW-NUR-006)**: consent, suppression, SMS quiet hours; unsubscribe footer → dedicated `/unsubscribe/<leadId>` page; STOP/HELP.
- [x] **Versioning + migrate policy (SW-NUR-007)**: editing an Active sequence forks a new version (**FINISH_OLD**, default) or edits in place (**MIGRATE**) per `Campaign.versionPolicy`.
- [x] **Analytics (SW-NUR-008)**: sequence (enrolled/active/completed/exited-by-reason) + per-step (sent/delivered/opened/clicked/**replied**/bounced/unsubscribed); `repliedCount` attributed to the step the lead last received.
- [x] Inngest determinism, isolated-send, quiet-hours retry, `enrollmentId` idempotency/concurrency.
- [~] **Remaining polish**: front-end UI to *edit* exit-conditions / version-policy / segment-enroll (backend + API done; wire the campaign settings panel); confirm delivered/opened/clicked populate from the live Brevo webhook; full mid-run MIGRATE (in-flight Inngest runs finish their loaded step list).

## 🤖 2. Appointment Scheduling Agent (SW-APT)
> Conversational AI agent (Claude + Inngest) that reads lead replies and books appointments automatically.
- [x] **Reply trigger (SW-APT-001)**: Detect when a lead replies to email/SMS and initiate flow.
- [x] **Simple booking mode**: Auto-send a booking-link response to the lead.
- [x] **AI conversational mode (SW-APT-002)**: Run a Claude tool-calling loop via Inngest steps.
- [x] **Availability API (SW-APT-003)**: Agent settings (hours, buffers, tz).
- [x] **Calendar Integration (SW-APT-003)**: Two-way busy/free sync with Google Calendar.
- [x] **Atomic slot reservation (SW-APT-007)**: DB-level double booking prevention.
- [x] **Booking record creation (SW-APT-004)**: Create appointment record, confirmation messages, reminders.
- [x] **Reschedule & cancel (SW-APT-005)**: Tokenized link reschedule/cancel.
- [x] **Agent guardrails (SW-APT-006)**: Escalate to human after 4 turns; deflect off-topic.

## 🤖 3. Content Calendar (SW-CAL)
> Central view of all scheduled outbound communication with AI slot suggestions.
- [x] **Reschedule API (SW-CAL-004)**: Enforce SMS quiet-hours window on new date.
- [x] **Status workflow (SW-CAL-005)**: Full lifecycle state machine (Suggested → Draft → Approved → Scheduled → Sent).
- [x] **Calendar executor**: Inngest job to dispatch `Scheduled` items.
- [x] **Owner field (SW-CAL-005)**: `ownerId` on ContentCalendar.
- [x] **AI content slot suggestions (SW-CAL-002)**: Feed seasonal events, news, gaps into AI suggestions.
- [x] **Accept/edit/dismiss API (SW-CAL-003)**: Record dismissals for ranking.
- [x] **First-class sources (SW-CAL-001)**: Surface announcements & blogs as items.

## 🤖 4. Announcements Agent (SW-ANN) — ✅ BUILT (email + SMS)
> Broadcasts fanned out to a lead audience by **email, SMS, or both** through the central compliance gate. `Announcement` model + `announcements.controller.js` + `/api/sales/announcements` + Inngest `sendAnnouncement` (`announcement.js`); frontend `sales/announcements` wired to the real API with a channel selector.
- [x] **Model & Authoring API (SW-ANN-001)**: `Announcement` model (title, subject, body, ctaLink, channel, audienceType, segmentId, geoFilter, status, metrics); full CRUD + preview endpoints.
- [x] **Channels + batch delivery via Inngest (SW-ANN-002)**: EMAIL/SMS/BOTH; channel-aware audience resolution; `announcement.send` → snapshot → chunked fan-out (50/chunk) → per-tenant concurrency + throttle (200/min) → per-lead+channel idempotency guard.
- [x] **Geographic targeting (SW-ANN-004)**: Filter by state/city/zip list in `resolveAnnouncementAudience`.
- [x] **Scheduling API (SW-ANN-003)**: `scheduledAt` → `step.sleepUntil`; cancel-until-processing via `announcement.cancel` event + `cancelOn`.
- [x] **Reporting (SW-ANN-005)**: Per-announcement sent/failed counters live per chunk; delivered/opened/clicked/unsubscribed fed from provider webhooks (email + SMS) via `ann_<id>` tag in `ComplianceService.handleMessageEvent`.
- [x] **Role restriction (SW-ANN-006)** + **Compliance (SW-ANN-007)**: Routes gated to `ADMIN`/`STAFF`; every send (email + SMS) passes `validateOutboundMessage` (consent, suppression, and TCPA quiet hours for SMS); email gets the unsubscribe footer, SMS gets the STOP opt-out suffix. Human-authored, so the "send" action satisfies the human-approval constraint.
- [ ] **Deferred to v2**: rich-text/image editor, radius geo-targeting, dead-letter queue surfacing in UI, per-timezone SMS quiet-hours deferral (blocked-by-quiet-hours SMS are currently skipped, not requeued).

## 🤖 5. CRM Sync Agent (SW-CRM)
> Keeps Salesforce leads in sync with the local lead database. **Substantially built** — models `SalesforceConnection`, `SyncLog`, `SalesforceFieldMapping`; service `salesforce-service.js` (AES-256-GCM token encryption); controller + routes at `/api/sales/salesforce`; UI at `sales/settings`.
- [x] **OAuth 2.0 flow (SW-CRM-002)**: Authorization-code connect + callback (`connectSalesforce`, `salesforceCallback`); tokens encrypted at rest.
- [x] **Connection management API (SW-CRM-003)**: Connect / disconnect / pause + status endpoints (`updateSalesforceStatus`); last sync time & last error surfaced.
- [x] **Field mapping API (SW-CRM-004)**: Mapping CRUD (`getMappings`/`saveMapping`/`deleteMapping`) with default mappings + consent-field flag.
- [x] **Initial bulk import (SW-CRM-005)**: `bulkImport` endpoint (filtered import from SF Lead).
- [~] **Incremental sync (SW-CRM-006)**: Watermark logic **exists** — `manualSync` queries `WHERE SystemModstamp > lastSyncAt`. **Gap: not on an Inngest cron** — sync is manual-triggered only. Add a scheduled per-tenant Inngest function (default 15 min).
- [ ] **Rate limit & backoff (SW-CRM-007)**: Confirm exponential backoff on 429/5xx and idempotent partial-failure handling; surface persistent failures as admin notifications.
- [ ] **Write-back to Salesforce (SW-CRM-008)**: Push status changes / appointment-booked / unsubscribe to mapped SF fields (off by default, per-tenant gate).
- [~] **Consent on import (SW-CRM-009)**: `isConsentField` mapping flag exists; confirm imported leads default to "consent unknown" and are excluded from SMS/opt-in-required email.

## 📄 6. CSV Upload (SW-CSV)
> Bulk lead ingestion via CSV. **Built** — `csv.controller.js` + Inngest `handleCsvImport` (`csv-import.js`, async background job) + UI in `sales/leads`. Not previously tracked here.
- [x] **CSV upload + async processing (SW-CSV-001/004)**: Upload endpoint routes to background Inngest import job.
- [ ] **Column mapping templates (SW-CSV-002)**: Confirm header auto-detect + savable mapping template.
- [ ] **Validation & preview (SW-CSV-003)**: Confirm pre-commit preview (valid/invalid/duplicate counts) + downloadable rejected-rows report.
- [ ] **Consent attestation (SW-CSV-005)** + **Homeowner limits (SW-CSV-006)**: Confirm attestation gate and lower per-homeowner caps.
- [ ] **CSV virus scan + 30-day retention (NFR-S-006)**.

## 🤖 7. News Scraping Agent (SW-NEWS)
> Collects and AI-summarizes housing market news, then **stores it for downstream use** — it does NOT send to leads.
- [x] **Configurable sources (SW-NEWS-001)**: RSS, APIs, web pages.
- [x] **Scheduled scraping (SW-NEWS-002)**: Inngest cron (daily).
- [x] **AI summarization (SW-NEWS-003)**: Summarize with Claude, store summary + link only.
- [x] **Consumption, no auto-send (SW-NEWS-004)**: **FIXED** — the previous auto-blast of scraped news to leads was removed (`news-scraper.js`). News now only feeds the Market News feed (`/api/sales/news`) + calendar suggestions (SW-CAL-002) + blog drafter (SW-BLOG). Nothing goes out until a human approves a calendar item / blog post (SRS Constraint #4 / NFR-U-002).
- [x] **Compliance (SW-NEWS-005)**: Summaries + links only, never full text.
- [x] **Failure isolation (SW-NEWS-006)**: Per-article steps isolate failures.

## 🤖 8. Blog Drafting Agent (SW-BLOG)
> Generates blog post drafts from news items. **Frontend page exists** (`sales/blog`, ~676 lines) — now shows an empty state (fabricated seed posts removed); **no backend model, API, route, or Inngest pipeline** yet.
- [ ] **News-to-draft pipeline (SW-BLOG-001)**: Claude generates draft.
- [ ] **Brand voice RAG (SW-BLOG-002)**: Pull brand profile + KB documents.
- [ ] **Human approval gate (SW-BLOG-004)**: Explicit approval required.
- [ ] **Publish/export (SW-BLOG-005)**.
- [ ] **Calendar integration (SW-BLOG-006)**.

## 🤖 9. Automated Marketing Rules Agent (SW-AMK) — ✅ BUILT
> Event-driven "if this happens, then do that" engine. `MarketingRule` + `MarketingRuleRun` models, engine `automation.js` (`runAutomationRules` on Inngest), `automations.controller.js` + `/api/sales/automations`, and the `sales/automations` builder UI wired to the API. Triggers emitted from the lead lifecycle via `lib/automation-events.js`.

### Build status
- [x] **Data model**: `MarketingRule` (triggerEvent, conditions[], actions[], isActive, cooldownHours, rateLimit, runCount, lastTriggeredAt) + `MarketingRuleRun` audit rows.
- [x] **Trigger/Condition/Action engine (SW-AMK-001)**: `evaluateRulesForTrigger` — evaluate conditions (EQUALS/NOT_EQUALS/CONTAINS/IN/IS_TRUE/IS_FALSE over lead fields incl. consent) → run actions (PAUSE_CAMPAIGNS, ENROLL_CAMPAIGN, UPDATE_STATUS, UPDATE_TAGS, NOTIFY_OWNER). Triggers emitted: **MANUAL_CREATION** (createLead), **STATUS_CHANGE** (updateLead), **LEAD_REPLIED** (reply webhooks ×3), **CRM_INGEST** (CSV import + Salesforce sync).
- [x] **Rule builder wiring (SW-AMK-002)**: `sales/automations` UI loads/creates/updates/deletes/toggles via the API; **activation blocked** for incomplete rules or an SMS action without an `smsOptIn=true` consent condition.
- [x] **Idempotent execution + loop prevention (SW-AMK-003)**: per-(rule, lead) **cooldown** (default 24h) via `MarketingRuleRun` history; UPDATE_STATUS writes directly (doesn't re-emit STATUS_CHANGE) to avoid loops.
- [x] **Kill switch (SW-AMK-004)**: `Company.automationsKillSwitch` — engine skips all rules when ON; one-click toggle in the UI header. Daily cap field stored (`automationDailyCap`).
- [x] **Audit & analytics (SW-AMK-005)**: every evaluation logs a `MarketingRuleRun` (MATCHED / SKIPPED_CONDITIONS / SKIPPED_COOLDOWN / ERROR); `/analytics` endpoint aggregates runs.
- [x] **Compliance**: rule-driven messaging goes through campaigns/notify which use the central compliance gate; SMS actions require a consent filter to activate.
- [~] **Remaining polish**: `send single email/SMS`, `create task`, `draft announcement` actions and `APPOINTMENT_BOOKED`/date-based triggers (SRS "should-haves") not yet wired; daily-cap enforcement is stored but not yet counted against sends; analytics UI panel (data + endpoint exist). **Verified E2E:** match→action→audit, cooldown block, kill-switch skip, and activation validation all tested against the live DB.

## 🤖 10. Sales KB & Brand Voice Agent (SW-KB / SW-AGT) — ✅ BUILT (needs keys to go live)
> RAG knowledge base. **DECISION (ratified): Pinecone vector store + OpenAI `text-embedding-3-small` (1536-dim) embeddings** — per SRS §11.1 (Pinecone named) and because Anthropic serves no embeddings. `vector-store.service.js` + Inngest `ingestKbDocument` (`kb-ingest.js`) + upgraded `kb.controller.js` / `/api/sales/kb`.
- [x] **Document upload API + UI (SW-KB-001)**: `POST /api/sales/kb/upload` (multer → Supabase `sales_knowledge_base` bucket → SalesKB row → fires `sales.kb.ingest`). PDF / DOCX / TXT (pdf-parse / mammoth / utf-8). **Uploader page at `/sales/knowledge-base`** (nav link added): drag-and-drop, category tagging, live indexing-status badges (auto-refresh while indexing), soft-delete, and a retrieval-test panel showing matches + citations.
- [x] **Chunking & embedding (SW-KB-002)**: Inngest extract → chunk (~1000 chars, 150 overlap) → OpenAI embed → Pinecone upsert into a **per-tenant Sales namespace** (`sales__<companyId>`), isolated from Warranty. Status tracked (PENDING→INDEXING→READY/FAILED), `chunkCount` recorded.
- [x] **Lifecycle / soft-delete (SW-KB-003)**: Delete = drop the doc's vectors from Pinecone (by deterministic ids) + `isDeleted=true` (row retained for rollback/audit); hidden from the active list.
- [x] **Category tagging (SW-KB-004)**: `category` on each doc + stored in vector metadata; retrieval supports a category filter.
- [x] **Citation visibility (SW-KB-005)**: `POST /api/sales/kb/search` returns top-k chunks + a de-duplicated citation list (documentId, name, category). AI features that draw on the KB record these when built.
- [x] **Brand voice & company profile (SW-KB-006)**: `Company.salesBrandProfile` (Json) + `GET/PUT /api/sales/kb/brand-profile`.
- [~] **Agent runtime abstraction (SW-AGT-001)**: Retrieval is a clean service (`vector-store.service.js`) any AI feature can call; consumers (blog drafter, nurture assist) wire it as they're built.
- [ ] **⚠️ LIVE ACTIVATION REQUIRED**: set `OPENAI_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX` in `server/.env` and create a **Pinecone serverless index (dimension 1536, metric cosine)**. Until then, uploads mark `FAILED: vector store not configured` and search returns 503. Code degrades gracefully.

## 🛡️ Webhooks & Compliance Spine (SW-CMP)
> Cross-cutting delivery compliance.
- [x] **Unified validateOutboundMessage**: Central gate.
- [x] **ESP/SMS event webhooks**: Handle delivery, bounces, clicks, complaints.
- [x] **Auto-suppress on bounce/complaint**: Map provider errors.
- [x] **Webhook authentication**: `X-Twilio-Signature` and `X-Webhook-Token`.
- [x] **Complaint-rate alerting (NFR-O-001)**.

## 🏗️ Cross-cutting Infrastructure & Security
- [ ] **Tenant-scoped Inngest context** (NFR-SC-002) + Dead-letter.
- [ ] **Secrets vault** (NFR-S-003).
- [ ] **Audit log table** (NFR-S-004).
- [ ] **GDPR/CCPA export/delete** (NFR-S-005).
- [ ] **CSV virus scan** (NFR-S-006).
- [ ] **Merge-field injection-safe rendering** (NFR-S-008).
- [ ] **AI PII minimization** (NFR-S-007).




## 🧠 RAG Knowledge Base for Nurture & Sales Agents (do later)
> Original ask: "Build a KB for the Nurture and Sales Agents using Pinecone."
> **DECISION: use pgvector on the existing Supabase Postgres instead of Pinecone/FAISS/Chroma.**

**Why pgvector (not Pinecone/FAISS/Chroma):**
- No new vendor/service — it's the Postgres we already run on Supabase (just enable the `vector` extension).
- Data lives on the live production server (same DB the agents already query) — meets the "data must be on live server" requirement with no external call.
- Minimal project size — vectors are DB rows, NOT files in the repo/deploy bundle (~6 KB per chunk; 10k chunks ≈ ~60 MB in DB, 0 MB added to app). FAISS = in-memory index file to manage; Chroma = a whole extra service + disk volume.
- Multi-tenant ready — reuse the existing `companyId` scoping on the vector rows.

**Open decision before build:** embedding provider — Anthropic key exists but Anthropic serves NO embeddings. Pick OpenAI `text-embedding-3-small` (1536-dim) or Voyage. Confirm before implementing.

**Where it plugs into the agents:**
- **Nurture Agent (`server/src/inngest/functions/nurture.js`) has NO LLM step today** — it's a deterministic template drip sender (merge fields only, `nurture.js:163-171`). A KB can't feed it until we add an AI generation step (either an "AI-personalized" step type, or route lead replies through the AI agent). Prereq, not a plug-in.
- **Appointment Agent (`server/src/inngest/functions/appointment.js`) is the clean insertion point** — it already runs a Claude tool-calling loop. Its prompt currently ESCALATES pricing/product/warranty questions because it has no knowledge source (`appointment.js:128`). Add a retrieval step before `claude-decide` (`appointment.js:230`): embed lead's message → pgvector top-k query → inject chunks + citations into the system prompt.

**Build checklist:**
- [ ] Enable `pgvector` extension on Supabase Postgres.
- [ ] Prisma migration: `kb_chunks` table (id, companyId, documentId, content, embedding vector, metadata) + IVFFlat/HNSW index. Map vector type via `Unsupported("vector")` / raw SQL.
- [ ] `server/src/services/vector-store.service.js`: embed(text), upsertChunks(), query(companyId, text, k).
- [ ] Inngest step on document upload: extract text → chunk → embed → upsert (soft-delete cascade on doc removal).
- [ ] Retrieval injection into appointment agent prompt (before `claude-decide`) with source citations.
- [ ] (Prereq for Nurture) add an AI generation step so the KB has something to feed there.

[ ] Build the KB (see decision + checklist above).
[ ] Prepare the Super Admin portal, allowing administrators to enable or disable workspaces for each tenant.
[ ] When a new tenant signs up, keep the entire dashboard in a read-only, greyed-out state and display a message informing them that they must complete payment or clear any outstanding invoices before they can access the portal.
[ ] When a new tenant signs up, automatically send an email notification to Steven informing him of the new registration. He can then upload the tenant’s invoice in the dashboard and enable the purchased workspaces.
[ ] After an invoice is uploaded, automatically share it with the tenant via email.
[ ] Send an onboarding/welcome email to the tenant after their first invoice has been paid.
[ ] Create the Terms of Service and Privacy Policy pages.
[ ] Enhance the Nurture Agent to automatically share news, mortgage rates, and home pricing updates using content generated by the blog scraper.
[ ] Complete the following Sales Workspace features by 10 July:
[ ] AI Content Calendar
[ ] Appointment Calendar
[ ] Lead Management
[ ] Blog Scraper