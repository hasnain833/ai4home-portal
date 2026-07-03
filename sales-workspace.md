# AI4Home Warranty Care Portal — Sales Workspace 

This document serves as the single, authoritative checklist and status tracker for the Sales Workspace backend functionality and agents. It maps directly to the SRS.

## 🤖 1. Nurture Agent (SW-NUR)
> Executes multi-step drip campaigns, ensuring compliant delivery and recording timeline events.
- [x] **Inngest determinism (C1)**: Sleeps use stable ids; wake times memoized.
- [x] **Duplicate-send risk (C2)**: Send is an isolated step with no DB writes; bookkeeping is separate.
- [x] **Quiet-hours retry (H1)**: Attempt-scoped re-check loop; sleeps until local TCPA window opens.
- [x] **Idempotency/concurrency key**: Function uses `event.data.enrollmentId` idempotency.
- [x] **Analytics (SW-NUR-008)**: Delivered/opened/clicked/bounced metrics processed via webhooks.
- [ ] **Versioning (SW-NUR-007)**: Verify version-on-edit + mid-sequence migration policy.

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

## 🤖 4. Announcements Agent (SW-ANN)
> Handles mass email/SMS broadcasts to lead segments with compliant batch delivery.
- [ ] **Model & Authoring API**: Announcement model + API for rich email/SMS authoring.
- [ ] **Batch delivery via Inngest (SW-ANN-002)**: Audience snapshot → chunk → throttle → retry → dead-letter.
- [ ] **Geographic targeting (SW-ANN-004)**: Filter by state/city/zip.
- [ ] **Scheduling API (SW-ANN-003)**: Schedule + cancel-until-processing.
- [ ] **Reporting (SW-ANN-005)**: Per-announcement metrics.
- [ ] **Role restriction (SW-ANN-006)**: Admin/Member only + compliance gate.

## 🤖 5. CRM Sync Agent (SW-CRM)
> Keeps Salesforce leads continuously in sync with the local lead database.
- [ ] **OAuth 2.0 flow (SW-CRM-002)**: Authorization code flow + secrets vault.
- [ ] **Connection management API**: Connect/disconnect/pause endpoints.
- [ ] **Field mapping API (SW-CRM-004)**: Versioned field mappings.
- [ ] **Initial bulk import (SW-CRM-005)**: Filtered import via Bulk API 2.0.
- [ ] **Incremental sync cron (SW-CRM-006)**: Inngest cron + `LastModifiedDate` watermarks.
- [ ] **Rate limit & backoff (SW-CRM-007)**: Exponential backoff on 429/5xx.
- [ ] **Write-back to Salesforce (SW-CRM-008)**: Push status changes/appointments.
- [ ] **Consent on import (SW-CRM-009)**: Default imported leads to "consent unknown".

## 🤖 6. News Scraping Agent (SW-NEWS)
> Collects and AI-summarizes housing market news.
- [x] **Configurable sources (SW-NEWS-001)**: RSS, APIs, web pages.
- [x] **Scheduled scraping (SW-NEWS-002)**: Inngest cron.
- [x] **AI summarization (SW-NEWS-003)**: Summarize with Claude + tag.
- [x] **Compliance (SW-NEWS-005)**: Honor robots.txt, rate limit.
- [x] **Failure isolation (SW-NEWS-006)**: Quarantine failing sources.

## 🤖 7. Blog Drafting Agent (SW-BLOG)
> Generates blog post drafts from news items.
- [ ] **News-to-draft pipeline (SW-BLOG-001)**: Claude generates draft.
- [ ] **Brand voice RAG (SW-BLOG-002)**: Pull brand profile + KB documents.
- [ ] **Human approval gate (SW-BLOG-004)**: Explicit approval required.
- [ ] **Publish/export (SW-BLOG-005)**.
- [ ] **Calendar integration (SW-BLOG-006)**.

## 🤖 8. Automated Marketing Rules Agent (SW-AMK)
> Event-driven automation engine.
- [ ] **Rule builder wiring (SW-AMK-002)**: Validate rules before activation.
- [ ] **Trigger/Condition/Action engine**.
- [ ] **Idempotent at-least-once (SW-AMK-003)**: Cooldown prevention.
- [ ] **Rate caps & kill switch (SW-AMK-004)**.
- [ ] **Audit & analytics (SW-AMK-005)**.

## 🤖 9. Sales KB & Brand Voice Agent (SW-KB / SW-AGT)
> Manages Sales workspace KB. **Vector store decision: use pgvector on the existing Supabase Postgres — NOT Pinecone/FAISS/Chroma.** See "RAG Knowledge Base" section below for rationale.
- [x] **Document upload API (SW-KB-001)**: Two stores already exist — `knowledgeBaseDocument` (Supabase storage upload) + `salesKB` (URL/metadata). These hold the FILES only; vector layer is the missing half.
- [ ] **Chunking & embedding (SW-KB-002)**: Inngest step + vector upsert into pgvector `kb_chunks` table (companyId-scoped).
- [ ] **Lifecycle (SW-KB-003)**: Soft-delete (cascade delete of chunks when a doc is removed).
- [ ] **Category tagging (SW-KB-004)**.
- [ ] **Citation visibility (SW-KB-005)**.
- [ ] **Brand voice & company profile (SW-KB-006)**.
- [ ] **Agent runtime abstraction (SW-AGT-001)**.

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