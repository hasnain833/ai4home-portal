# Warranty Care Portal - Implementation Tracker

## 🏗️ Technical Architecture Analysis (Current State)
* **Framework:** Next.js 16+ (App Router, Turbopack) with React 19.
* **Database:** Supabase PostgreSQL managed via Prisma 7.
* **Authentication:** Custom JWT/Context-based role system (ADMIN, STAFF, HOMEOWNER).
* **AI & Chat Integration:** Integrated Botpress Webchat dynamically via client-side script injection and iframe containers, replacing local LLM servers.
* **ERP Integration:** `erp-service.ts` features a production-ready HTTP Fetch client for Builtopia with Bearer token authentication, fully replacing the mock timeout simulations.

---

## ✅ Phase 0: Foundation (Complete)
- [x] **Database Schema**: Supabase + Prisma 7 with User, Company, Ticket, AgentConfig, and KB models.
- [x] **Authentication**: Secure login/signup system with role-based access.
- [x] **Ticket Dashboard (FR-10)**: Real-time KPI cards and recent tickets list.
- [x] **Ticket Management (FR-07)**: Full list view and individual ticket detail view.
- [x] **Company Configuration (FR-14)**: UI and API for managing builder profile and warranty policy.
- [x] **Agent Configuration (FR-12)**: Deprecated/removed local `/agent-config` admin panels and API endpoints. AI prompts, greeting parameters, and escalation flows are now fully offloaded to **Botpress Studio** in the cloud.
- [x] **Knowledge Base Management (FR-13)**: Document tracking system.
- [x] **ERP/CRM Connectors (FR-06/FR-11)**: Implemented robust REST `fetch` client in `erp-service.ts` for Builtopia integration.
- [x] **Advanced Ticket Filters (SRS 4.3.1)**: Add date range and specific property filters to the Warranty Ticket Dashboard.

---

## 🚧 Phase 1: Core Intelligence & Handoff Integration (Complete)
- [x] **Homeowner Property Support (FR-18)**: Refactored schema to support multiple properties per user.
- [x] **Warranty Year Logic (FR-02)**: Automated Year 1/2/10 calculation based on Property COE Date.
- [x] **Embedded Inline Chat Screen (FR-17/FR-18)**: Integrated Botpress Webchat v3.6 in embedded/inline mode using container ID `bp-embedded-webchat`. Formatted to automatically open on load, constrained within a centered responsive container (`max-w-4xl`), and cleaned up all floating bubble widgets.
- [x] **DIY Guidance Engine (FR-05)**: Offloaded to Botpress Studio; step-by-step instructions are provided natively during the chat experience.
- [x] **Emergency Detection (FR-03)**: Offloaded to Botpress Studio; life-safety issues are flagged automatically by Botpress and sent to the escalation webhook.
- [x] **Human Escalation Handoff (FR-09)**: Displays the full handoff context (including chat summary and specific issue details) extracted by Botpress and received via integration webhooks.
- [x] **Conversation Transcript Storage (FR-17)**: Preserved conversational data models and ticket links to support external webhook integrations.
- [x] **Detailed KPI Reporting (FR-15)**: Real-time resolution time, weekly trends, and token consumption analytics.
- [x] **Status Notifications (FR-16)**: Integrated Brevo for automated email updates on ticket status changes.
- [x] **Secure Password Recovery**: Implemented stateless client-side OTP validation flow using Brevo to protect resources without database persistence.
- [x] **Botpress Ticket Escalation**: Created dedicated secure webhook integration API to receive Botpress escalations and conversation transcripts.
- [x] **Dynamic ERP Integrations**: Created a 3-card Admin management dashboard to save credentials directly to DB rather than `.env`.
- [x] **Role-Based Access Control (RBAC)**: Enforced strict role-based scopes (Admin, Staff, Homeowner) in backend APIs (Tickets, Dashboard, Company, Config, KB) and custom homeowner-focused dashboard client UI.
- [x] **Property Management Hub**: Implemented a comprehensive property management dashboard including a role-scoped client page (`/properties`), dynamic backend APIs (`/api/properties`), search filters, and an interactive property creation modal.
- [x] **Anti-Litigation Guardrails (FR-08)**: Handled via Botpress system prompt constraints and portal-synced Agent Configurations.
- [x] **Issue Diagnosis Repair Groups (FR-04)**: Handled natively within the Botpress agent workflows based on David Dell IP logic.
- [x] **KB Document Utilization Display (SRS 4.3.4)**: Update the ticket or conversation view to show which knowledge base documents were referenced by the agent.

---

## 🔮 Phase 2: Botpress-Driven Multi-Agent System (Integration & APIs)
- [x] **Agent Action Webhooks**: Removed local endpoints (Diagnostics, ERP/Builtopia lookup, Policy validation) as all diagnostics/actions are handled natively by Botpress backend.
- [x] **Botpress Orchestration Sync**: Support multi-turn routing and handoffs driven entirely within the Botpress agent workflows.
- [x] **Webchat Integration Env Variables**: Stored v3.6 integration scripts (`NEXT_PUBLIC_BOTPRESS_INJECT_URL` and `NEXT_PUBLIC_BOTPRESS_CONFIG_URL`) inside `.env` and loaded them dynamically with React lifecycle unmount cleanups.
- [x] **Obsolete UI Cleanup**: Removed the unused local `/agent-config` admin pages, routes, API endpoints, and sidebar layout link references.
- [x] **Human-in-the-Loop Approval**: Create a dashboard interface for staff to approve/edit draft responses compiled by Botpress agents before sending.
- [x] **Token & Cost Monitoring**: Managed and monitored directly within Botpress backend analytics platforms (no local implementation required).
- [x] **Agent Traceability**: Tracked and logged directly in Botpress backend conversation logs.
- [x] **MAS Trigger Routing Configuration**: Configured and executed directly within Botpress workflow orchestrator.
- [x] **Reviewer Agent Toggle**: Orchestrated directly inside Botpress workspace settings.
- [x] **Dynamic User KB Mapping**: Add `knowledgeBaseId` field to User and Company models.
- [x] **Shared/Common Knowledge Base Files**: Support uploading and tagging documents as "Shared/Common" (all communities) via UI and bulk ZIP uploads.

---

## 🛠️ Testing & Workflow
### Current Workflow
1. **Admin Setup**: Configure Company, Integrations, and Knowledge Base.
2. **Homeowner Claim**: User chats with AI -> AI checks Property COE -> AI injects KB -> AI provides DIY -> If unresolved/emergency, AI automatically generates Ticket + links Conversation.
3. **Staff Action**: Review tickets + transcript in Dashboard -> Update status -> Brevo emails Homeowner -> Syncs to ERP.

### Testing Plan
- [x] **Database Connectivity**: Verified Prisma schema sync and User authentication hashing.
- [x] **AI Intelligence Flow**: Verified Botpress integration webhooks and database persistence.
- [ ] **Multi-Property**: Verify tickets link to correct property when homeowner has multiple.
- [ ] **Integration**: Test full loop of Builtopia sync status via external webhook.
- [ ] **Notifications**: Verify Brevo email delivery on status change.

---

## 📅 Upcoming Features (Backlog)
- [x] **AI Assistant Embed & Multi-Tenancy Architecture**
  - [x] Create script embed option so users can integrate the AI assistant into their own websites.
  - [x] **Dynamic Widget Generation**: Modify embed script to automatically inject the specific builder's `companyId` into the Botpress `userData` payload.

---

## 🚀 Sales Workspace Extension

### 🏗️ Planned Technical Additions
* **Workflow Engine:** Use Inngest to run background tasks safely.
  * Syncing with CRM
  * Running campaigns
  * Processing CSV uploads
  * Running AI agents
* **CRM Connection:** A system to connect outside tools.
  * Start with Salesforce integration
* **AI Agent Setup:** Build a system to swap between different AI tools.
  * Claude AI vs. Botpress
* **Data Separation:** Keep Sales data and Warranty data completely separated in the database.

---

### 📅 Phase 3: Hub & Lead Setup *(UI Built — Functionality Pending)*
- [x] **Workspace Navigation** *(UI done)*:
  - Add a Hub page to pick a workspace after login
  - Add a switcher in the top menu
  - Remember the last workspace the user visited
  - [ ] **Wire up HUB-001**: Route single-workspace users directly in; show hub only for multi-workspace users
  - [ ] **Wire up HUB-006**: Persist last active workspace to user profile; restore on next login
  - [ ] **Wire up HUB-007**: Tag all notifications with source workspace; deep-link notifications into the correct workspace
  - [ ] **Wire up HUB-009**: Implement per-tenant feature flag to enable/disable the Sales workspace
- [x] **Data Separation** *(UI done)*:
  - Separate database permissions
  - Keep Warranty and Sales features independent
  - [ ] **Enforce HUB-004 at API layer**: Audit all Sales API routes to ensure they cannot read or write Warranty tables
- [x] **Lead Database Structure** *(UI done)*:
  - [ ] **Prisma schema**: Add `Lead`, `LeadSegment`, `LeadActivity`, `ConsentFlag`, `Suppression`, `LeadCustomField` models with `tenantId` scoping
  - [ ] **Lead CRUD API** (`/api/sales/leads`): Create, read, update, archive; enforce RBAC (Homeowner sees own leads, Builder Member sees assigned leads, Builder Admin sees all)
  - [ ] **Deduplication logic (SW-LEAD-003)**: On import, detect duplicates by email then phone; support skip/update/create-anyway merge strategies
  - [ ] **Segment engine (SW-LEAD-004)**: Evaluate saved segments dynamically at send time based on lead field filters, tags, consent, and engagement events
  - [ ] **Activity timeline API**: Record and retrieve all timeline events per lead (messages, enrollments, appointments, imports, consent changes)
  - [ ] **Lead lifecycle status API (SW-LEAD-006)**: Tenant-configurable status set (New, Nurturing, Engaged, Appointment Set, Qualified, Closed Won, Closed Lost, Unsubscribed); support manual and automated status transitions
- [x] **CSV Upload Tool** *(UI done)*:
  - [ ] **File upload API** (`/api/sales/csv/upload`): Accept CSV, enforce 25 MB / 100K row limits
  - [ ] **Column mapping & preview API**: Auto-detect headers, propose canonical field mapping, validate rows, return counts of valid/invalid/duplicate rows
  - [ ] **Consent attestation step**: Block import unless user confirms contact consent
  - [ ] **Async import job via Inngest**: Background processing with per-row error capture; notify user on completion; provide downloadable error report CSV (SW-CSV-004)
  - [ ] **Homeowner upload limits (SW-CSV-006)**: Enforce lower limits (500 total leads, 1,000 rows/file) for Homeowner role
- [x] **Sales Dashboard** *(UI done)*:
  - [ ] **Dashboard data API** (`/api/sales/dashboard`): Return lead counts by status, active sequences with key metrics, upcoming calendar items, upcoming appointments, and CRM sync health
  - [ ] **CSV export for all reporting views** (SW-DSH-002)
  - [ ] **Real-time batch progress**: Surface announcement and import progress via polling or websocket

---

### 📅 Phase 4: Integrations & Campaigns *(UI Built — Functionality Pending)*
- [x] **Salesforce Connection** *(UI done)*:
  - [ ] **OAuth 2.0 flow (SW-CRM-002)**: Implement authorization code flow; store access/refresh tokens in secrets vault (never in `.env` or logs)
  - [ ] **Connection management API** (`/api/sales/crm`): Connect, reauthorize, pause, disconnect; expose connection state, last sync time, last error
  - [ ] **Field mapping UI wiring (SW-CRM-004)**: Map Salesforce fields → canonical lead fields; support custom fields; version mappings so changes only affect future syncs
  - [ ] **Initial import job (SW-CRM-005)**: Filtered import via Salesforce list view / record type / SOQL builder; use Bulk API 2.0 for >2,000 records; report progress and per-record errors
  - [ ] **Incremental sync cron via Inngest (SW-CRM-006)**: Poll every 15 min (configurable 5min–24hr) using `LastModifiedDate` watermarks; archive (not delete) removed records
  - [ ] **Rate limit & idempotent backoff (SW-CRM-007)**: Respect Salesforce API limits; exponential backoff on 429/5xx; surface failures as actionable notifications; never partially corrupt lead state
  - [ ] **Write-back to Salesforce (SW-CRM-008)**: Optional push of lead status changes, appointment booked events, unsubscribe flags to mapped SF fields (off by default, per tenant)
  - [ ] **Consent on import (SW-CRM-009)**: Default imported leads to "consent unknown"; exclude from sends where opt-in is required unless a mapped field provides explicit opt-in
- [x] **Compliance Rules** *(UI done)*:
  - [ ] **Central compliance service**: Before every outbound send check: (1) per-channel consent flag, (2) suppression list, (3) SMS quiet hours 8am–9pm lead-local time (TCPA), (4) unsubscribe mechanism present
  - [ ] **Suppression list management**: Global per-tenant suppression; auto-add on STOP/unsubscribe/bounce/complaint
  - [ ] **Inbound webhook handlers**: ESP and SMS provider webhooks for delivery receipts, opens, clicks, bounces, complaints, replies, STOP/HELP keywords
  - [ ] **STOP/HELP auto-processing**: Detect STOP/HELP keywords in inbound SMS and immediately update lead consent flags
- [x] **Drip Campaigns / Nurture Sequences** *(UI done — see Nurture Agent below)*

---

### 📅 Phase 5: Announcements & Calendar *(UI Built — Functionality Pending)*
- [x] **Mass Announcements** *(UI done — see Announcements Agent below)*
- [x] **Content Calendar** *(UI done)*:
  - [ ] **Calendar data API** (`/api/sales/calendar`): Return scheduled items (nurture sends aggregate, announcements, blog posts, campaign sends) with status and owner
  - [ ] **Drag-and-drop reschedule API**: Update send schedule of a calendar item; enforce compliance windows on new date
  - [ ] **AI content slot suggestions (SW-CAL-002)**: Call the Content Assist Agent to generate suggested slots from tenant profile, seasonal events, scraped news, and schedule gaps
  - [ ] **Accept / edit / dismiss suggestion API**: Creating draft item on accept; feed dismissals back into suggestion ranking
  - [ ] **Item status workflow**: Move items through Suggested → Draft → Approved → Scheduled → Sent/Published → Failed; enforce approval gate per tenant policy
- [x] **Basic Appointment Booking** *(UI done — see Scheduling Agent below)*

---

### 📅 Phase 6: Advanced AI Features *(UI Built — Functionality Pending)*
- [ ] **AI Booking Agent** *(see Scheduling Agent in Agents Registry below)*
- [x] **News Fetcher** *(UI done — see News Scraping Agent below)*
- [x] **AI Blog Writer** *(UI done — see Blog Drafting Agent below)*
- [x] **Smart Automations** *(UI done — see Automated Marketing Rules Agent below)*
- [x] **Sales AI Knowledge Base** *(UI done — see KB & Brand Voice Agent below)*

---

## 🤖 AI Agents Registry

The Sales workspace is powered by **9 specialized AI agents**. All agents use Claude (via the platform AI service) + Inngest as the durable automation tier. Agents share the platform LLM and vector store but maintain strict per-workspace, per-tenant namespace isolation from Warranty data.

---

### 1. 🌱 Nurture Agent *(SW-NUR) — In Progress*
> Manages drip email/SMS sequences — each lead follows an ordered set of steps with configurable delays between them.

- [ ] **Sequence execution engine**: Send ordered steps (email or SMS) with timing defined per step (e.g. "wait 3 days", with optional send window such as weekdays 9am–6pm lead-local time)
- [ ] **Durable step sleep via Inngest** (`step.sleep`): Multi-day waits that survive server restarts and deploys; support 1–50 steps per sequence
- [ ] **Enrollment logic (SW-NUR-002)**: Enroll leads manually (single or bulk), by segment, or via automation trigger; prevent duplicate enrollment in same sequence; warn on concurrent enrollment in multiple sequences
- [ ] **Exit condition handling (SW-NUR-003)**: Auto-exit sequence when lead replies, books appointment, unsubscribes, changes to a configured status, or is manually removed; stop all further steps immediately
- [ ] **Reply ingestion (SW-NUR-004)**: Receive inbound email/SMS webhooks from ESP/SMS provider; attach reply to lead timeline; trigger exit condition and appointment flow where configured
- [ ] **Compliance gate (SW-NUR-006)**: Before every send, enforce: consent check per channel, suppression list check, SMS quiet hours (8am–9pm lead-local time per TCPA), mandatory unsubscribe footer (email) / STOP instruction (SMS)
- [ ] **STOP/HELP keyword processing**: Auto-process STOP/HELP replies; update lead consent flags immediately; never send another SMS to an opted-out number
- [ ] **AI content assist (SW-NUR-005)**: In the sequence editor, generate AI draft copy per step based on sequence goal, audience description, and brand voice; require explicit human approval before any AI draft is activated for sending
- [ ] **Sequence versioning (SW-NUR-007)**: Editing an active sequence creates a new version; existing enrolled leads continue on old version or migrate at next step, per tenant policy choice
- [ ] **Per-sequence analytics (SW-NUR-008)**: Track and display per-sequence and per-step: enrolled, active, completed, exited (by reason), sent, delivered, opened, clicked, replied, unsubscribed, bounced

---

### 2. 📅 Appointment Scheduling Agent *(SW-APT)*
> Conversational AI agent (Claude + Inngest) that reads lead replies and books appointments automatically.

- [ ] **Reply trigger (SW-APT-001)**: Detect when a lead replies to email/SMS (via ESP/SMS webhook → Inngest event) and initiate appointment scheduling flow per the configuration of the originating sequence/announcement
- [ ] **Simple booking mode**: Auto-send a booking-link response to the lead pointing to the assigned user's availability page; lead self-books
- [ ] **AI conversational mode (SW-APT-002)**: Run a Claude tool-calling loop via Inngest steps — interpret reply in natural language, propose available time slots, handle counter-proposals, confirm and book on agreement
- [ ] **Availability management UI wiring (SW-APT-003)**: Let agents set working hours, buffer times, appointment types/durations, and time zone in the `/sales/scheduling/settings` page; wire to backend API
- [ ] **Google Calendar / Microsoft 365 integration (SW-APT-003)**: Two-way busy/free sync; fall back to native availability management if calendar integration not connected
- [ ] **Atomic slot reservation (SW-APT-007)**: Prevent double bookings with DB-level atomic reservation; concurrent attempts for the same slot must result in exactly one success plus a graceful re-offer for the other
- [ ] **Booking record creation (SW-APT-004)**: Create appointment record linked to lead, native calendar entries, confirmation messages to both parties, configurable reminders (default 24h and 1h before)
- [ ] **Reschedule & cancel (SW-APT-005)**: Lead can reschedule/cancel via a tokenized link; staff can do so from the lead detail view; update lead timeline and calendars on change
- [ ] **Agent guardrails (SW-APT-006)**: Only offer genuinely available slots; deflect off-topic questions politely and offer human follow-up; escalate to human after 4 unresolved turns; identify itself as an automated assistant where required by law or tenant policy; log full transcript to lead timeline
- [ ] **Inngest step function**: Entire booking conversation runs as retriable durable Inngest steps; reply event starts flow; atomic reservation is a separate step

---

### 3. 📰 News Scraping Agent *(SW-NEWS)*
> Automatically collects and AI-summarizes housing market news on a scheduled cadence.

- [ ] **Configurable news sources (SW-NEWS-001)**: Support RSS/Atom feeds, public APIs, and permitted web pages per tenant; seed with platform defaults for housing/mortgage content
- [ ] **Scheduled scraping via Inngest cron (SW-NEWS-002)**: Daily, weekly, and monthly digests; mortgage rate updates at minimum daily; per-source isolation so one failing source doesn't affect others
- [ ] **AI summarization & tagging (SW-NEWS-003)**: Deduplicate collected items; summarize with Claude; tag by topic, geography, and date; store with source attribution (publisher, URL, retrieved-at timestamp)
- [ ] **robots.txt & rate-limit compliance (SW-NEWS-005)**: Honor robots.txt; identify with proper user agent; rate-limit per domain; store summaries + links only (no full-text republication)
- [ ] **Failure isolation (SW-NEWS-006)**: Quarantine a failing source after repeated errors without affecting others; surface quarantine status to Platform Admin
- [ ] **News feed page** (`/sales/news`): Display collected items in daily/weekly/monthly views; connect to real backend data
- [ ] **Feed to calendar suggestions**: Pass news items to the Content Assist Agent as input for AI calendar slot suggestions (SW-CAL-002)
- [ ] **Feed to blog drafter**: Expose news items as selectable source material in the Blog Drafting Agent pipeline

---

### 4. ✍️ Blog Drafting Agent *(SW-BLOG)*
> AI pipeline (Claude + Inngest) that generates blog post drafts from news items for human review and publishing.

- [ ] **News-to-draft pipeline (SW-BLOG-001)**: User selects news items from the news feed (or agent proposes them) → Claude generates draft → human reviews and edits → approves → publish or export
- [ ] **Draft generation with brand voice (SW-BLOG-002)**: Pull tenant brand profile (tone, target audience, markets) and relevant KB documents (brand voice, product info) at generation time (RAG); include SEO title, meta description, and suggested headings; cite source news items explicitly
- [ ] **Rich text editor (SW-BLOG-003)**: Full editing of AI-generated drafts in the `/sales/blog` editor; allow AI to regenerate individual sections without losing manual edits elsewhere
- [ ] **Human approval gate (SW-BLOG-004)**: No post can be published or exported without an explicit human approval action; clearly label all drafts as "pending review"
- [ ] **Publish to workspace blog (SW-BLOG-005)**: Support publishing to the tenant's workspace-hosted blog page; export as HTML or Markdown for external CMS use; WordPress integration is a stretch goal
- [ ] **Calendar integration (SW-BLOG-006)**: Schedule approved blog posts via the content calendar; cross-promote via announcement or campaign link distribution
- [ ] **Inngest pipeline**: Run the entire select → draft (LLM) → await-human-approval (event) → publish/export flow as durable Inngest steps; support restart after approval event arrives

---

### 5. 📣 Announcements Agent *(SW-ANN)*
> Handles mass email/SMS broadcasts to lead segments with compliant batch delivery.

- [ ] **Announcement authoring wiring**: Connect the `/sales/announcements` form to backend API; support rich text body (email), plain-text variant (SMS), optional images (email), optional CTA link, and target audience (segment, geographic filter, or all leads)
- [ ] **Batch delivery pipeline via Inngest (SW-ANN-002)**: Audience snapshot at send time → chunk into provider-appropriate batches → queue → throttle to provider rate limits → auto-retry transient failures → dead-letter permanent failures
- [ ] **Geographic targeting (SW-ANN-004)**: Filter recipients by state, city, or zip list; radius targeting is a stretch goal
- [ ] **Scheduling API (SW-ANN-003)**: Send immediately or schedule (surface in content calendar); allow cancellation until the batch pipeline starts processing
- [ ] **Per-announcement reporting (SW-ANN-005)**: Audience size, sent, delivered, failed, opened, clicked, replied, unsubscribed — broken down by channel; update in near real-time as batch progresses
- [ ] **Compliance enforcement (SW-ANN-007)**: Every announcement send passes the central compliance gate (consent per channel, suppression, quiet hours, unsubscribe mechanism)
- [ ] **Role restriction (SW-ANN-006)**: Only Builder Admin and authorized Builder Member can publish; homeowners have no access to announcement authoring; enforce at API level

---

### 6. 🤖 Automated Marketing Rules Agent *(SW-AMK)*
> Event-driven automation engine — define trigger → conditions → actions rules to run asynchronously.

- [ ] **Visual rule builder wiring (SW-AMK-002)**: Connect the `/sales/automations` drag-and-drop UI to backend; validate rules before activation (e.g. block SMS actions without consent filter)
- [ ] **Trigger support**: Lead created/imported, segment entry, lead replied, link clicked, appointment booked/cancelled, status changed, date-based (anniversary of inquiry), news event published
- [ ] **Condition evaluation**: Lead field comparisons, consent state, engagement history, time constraints
- [ ] **Action execution**: Enroll in/remove from sequence, send single email/SMS, update status or tags, notify a user, create a task, schedule announcement draft
- [ ] **Idempotent at-least-once execution (SW-AMK-003)**: Apply each action at most once per lead per trigger event; prevent automation loops with a configurable cooldown per lead per rule (default 24 hours)
- [ ] **Per-tenant rate caps & kill switch (SW-AMK-004)**: Platform Admin-configurable daily message cap; instant kill switch that pauses all automations for a tenant immediately
- [ ] **Audit log & analytics (SW-AMK-005)**: Log every automation run (trigger event, conditions evaluated, actions taken, outcome); aggregate analytics: runs, actions, messages generated, appointment conversions attributable to the automation
- [ ] **Inngest event-driven backend**: Run all automation executions as idempotent Inngest event-driven steps with cooldown keys; concurrency scoped per tenant

---

### 7. 💬 AI Content Assist Agent *(SW-NUR-005 / SW-CAL-002)*
> Embedded AI helper for writing nurture step content and generating content calendar suggestions.

- [ ] **Sequence step content drafting (SW-NUR-005)**: In the sequence editor, call Claude to draft email/SMS copy per step; inputs: sequence goal, audience description, brand voice settings, and relevant KB documents; output requires explicit user approval before being set as active step content
- [ ] **Calendar slot suggestions (SW-CAL-002)**: Generate AI-proposed content slots from tenant profile (markets, communities), seasonal events, scraped news items, and gaps in the existing calendar schedule; include proposed date, channel, topic, and draft outline
- [ ] **Accept / edit / dismiss flow (SW-CAL-003)**: Accept creates a draft calendar item; edit opens the item for modification; dismiss is recorded to inform future suggestion ranking
- [ ] **KB-aware RAG generation**: Pull relevant documents from the Sales Knowledge Base (brand voice, FAQs, product info) at generation time using the per-tenant vector namespace
- [ ] **Citation tracking (SW-KB-005)**: For every AI output, record and display which KB documents were referenced; mirror the Warranty workspace's "documents referenced in a ticket" behavior
- [ ] **Streaming / progress indication**: AI draft generation must return within 30 seconds at p95 with streaming or progress UI feedback (NFR-P-006)

---

### 8. 🔍 CRM Sync Agent *(SW-CRM)*
> Background agent that keeps Salesforce leads continuously in sync with the local lead database.

- [ ] **OAuth 2.0 Salesforce connection (SW-CRM-002)**: Implement authorization code flow in the settings page; store access/refresh tokens in secrets vault; support reauthorization on token expiry
- [ ] **Connection management API** (`/api/sales/crm/connect`, `/pause`, `/disconnect`): Expose connection state, last sync time, last sync error; disconnecting stops future syncs but retains existing leads
- [ ] **Field mapping API (SW-CRM-004)**: Store versioned field mappings; apply changes to subsequent syncs only; support mapping custom Salesforce fields to tenant custom fields
- [ ] **Initial bulk import (SW-CRM-005)**: Run filtered initial import via Salesforce list view / record type / SOQL-equivalent filter; use Salesforce Bulk API 2.0 for volumes >2,000 records; emit progress events to Inngest; capture per-record errors
- [ ] **Incremental sync cron (SW-CRM-006)**: Inngest cron job (default every 15 min, configurable 5min–24hr) using `LastModifiedDate` watermarks; idempotent upserts; archive local record when deleted in Salesforce (never hard-delete)
- [ ] **Rate limit & failure handling (SW-CRM-007)**: Respect Salesforce API daily/concurrent limits; exponential backoff on 429/5xx; surface persistent failures as actionable admin notifications; ensure syncs never partially corrupt lead state
- [ ] **Write-back to Salesforce (SW-CRM-008)**: Optionally push lead status changes, appointment booked events, and unsubscribe flags to mapped Salesforce fields; off by default; gated per tenant
- [ ] **Consent on import (SW-CRM-009)**: Default all imported leads to "consent unknown" unless a mapped Salesforce field provides explicit opt-in; exclude unknown-consent leads from SMS and opt-in-required email per tenant compliance profile

---

### 9. 📚 Sales KB & Brand Voice Agent *(SW-KB / SW-AGT)*
> Manages the Sales workspace knowledge base and injects brand context into all AI feature calls.

- [ ] **Document upload UI wiring (SW-KB-001)**: Connect drag-and-drop upload in `/sales/settings` to backend API; enforce per-file 50 MB and per-tenant 10 GB limits; show real-time indexing status
- [ ] **Chunking, embedding & vector indexing (SW-KB-002)**: Process uploaded documents via Inngest step function: chunk → embed (platform embedding model) → upsert to vector store under a Sales-workspace per-tenant namespace; re-index automatically on document update
- [ ] **KB lifecycle management (SW-KB-003)**: Add, update, soft-delete through list view API; soft-delete removes from active retrieval but retains in storage for rollback and audit
- [ ] **Document category tagging (SW-KB-004)**: Tag documents by purpose (brand voice, community/product info, sales FAQs, pricing/policy, compliance); each AI feature queries only the relevant category subset
- [ ] **Citation visibility (SW-KB-005)**: Record and display which KB documents were referenced for every AI output (blog drafts, scheduling-agent answers, nurture content)
- [ ] **Brand voice & company profile (SW-KB-006)**: Configurable structured profile (company name, logo, markets/communities, tone, signature, contact and unsubscribe details); injected into Claude prompts at runtime; edited through forms (not raw prompt editing)
- [ ] **Configuration versioning & sandbox (SW-KB-007)**: Version all prompt-affecting config (brand profile, agent behavior toggles) with rollback; support preview/sandbox mode to test AI behavior before it affects live sends
- [ ] **Agent runtime abstraction (SW-AGT-001)**: Sales AI features run behind a pluggable agent-runtime interface; scheduling agent can run on native Claude + Inngest (recommended v1) or BotPress; choice does not change lead-facing behavior or compliance guarantees
- [ ] **Shared LLM & vector services (SW-AGT-002)**: Reuse platform Claude service and vector store (Pinecone/Weaviate); do not introduce parallel providers; enforce strict namespace isolation from Warranty data

---

## 🏗️ Backend Infrastructure (Sales Workspace)

### Inngest Automation Tier
- [ ] **Install & configure Inngest**: Add `inngest` package to Node.js backend; set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`; create Inngest client and HTTP serve handler
- [ ] **Tenant-scoped event context**: Every Inngest event must carry `tenantId`; every step must enforce tenant-scoped DB access
- [ ] **Per-tenant concurrency keys & throttling**: Configure per-tenant concurrency limits to prevent workload starvation across tenants (NFR-SC-002)
- [ ] **Dead-letter queue handling**: Surface permanently-failed jobs to Platform Admin with actionable notifications

### Email & SMS Provider Integration
- [ ] **Select and integrate ESP** (e.g. Resend, Postmark, or SendGrid): Configure sending domains with SPF/DKIM/DMARC per tenant; support inbound reply parsing via webhooks
- [ ] **Select and integrate SMS provider** (e.g. Twilio): E.164 normalization; per-country sender rules; delivery receipts and inbound STOP/HELP
- [ ] **Unified send interface**: All outbound sends go through the compliance gate first, then the unified send service

---

## 🔐 Security & Compliance
- [ ] **Tenant isolation audit**: Verify every new Sales API route is scoped by `tenantId` at the DB query layer — not just at RBAC level (NFR-S-002)
- [ ] **Secrets vault for OAuth tokens**: Store Salesforce OAuth tokens and ESP/SMS API keys in a secrets manager; never in `.env` or logs; must be revocable (NFR-S-003)
- [ ] **Audit log table**: Log CRM connect/disconnect, imports, exports, bulk deletes, automation activations, announcement sends, permission changes, Platform Admin access to tenant data; 12-month retention (NFR-S-004)
- [ ] **GDPR/CCPA data subject request flow**: Export all lead data for a subject on request; delete lead PII on request propagating to derived stores and vector namespaces
- [ ] **CSV virus scanning (NFR-S-006)**: Scan uploaded CSVs before processing; auto-delete raw CSV files 30 days post-import
- [ ] **Merge field injection safety (NFR-S-008)**: Render email merge fields in a sandboxed context; prevent script execution in HTML email preview (OWASP ASVS level 2)
- [ ] **AI PII minimization (NFR-S-007)**: Prompts containing lead PII must be minimized to only the fields needed for the task; AI inputs/outputs must not be used to train external models
