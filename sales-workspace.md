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
- [ ] **Configurable sources (SW-NEWS-001)**: RSS, APIs, web pages.
- [ ] **Scheduled scraping (SW-NEWS-002)**: Inngest cron.
- [ ] **AI summarization (SW-NEWS-003)**: Summarize with Claude + tag.
- [ ] **Compliance (SW-NEWS-005)**: Honor robots.txt, rate limit.
- [ ] **Failure isolation (SW-NEWS-006)**: Quarantine failing sources.

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
> Manages Sales workspace KB.
- [ ] **Document upload API (SW-KB-001)**.
- [ ] **Chunking & embedding (SW-KB-002)**: Inngest step + vector upsert.
- [ ] **Lifecycle (SW-KB-003)**: Soft-delete.
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
