# AI4Home Warranty Care Portal — Workspace Checklist

This document serves as the single, authoritative checklist and status tracker for the Warranty Workspace codebase against the **Ai.Lumen Warranty Care Agent SRS v1.0**.

## 💬 1. Core Intelligence & Intake (Phase 1)
> 24/7 homeowner intake, diagnosis, and property logic.
- [x] **FR-01 Homeowner Intake**: Achieved via Botpress embedded in `warranty/chat/page.tsx`.
- [x] **FR-02 COE Date Lookup**: Automated Year 1/2/10 calculation based on Property COE Date.
- [x] **FR-03 Emergency Detection**: Life-safety issues flagged by Botpress and escalated.
- [x] **FR-04 Issue Diagnosis**: Handled natively within Botpress agent workflows.
- [x] **FR-05 DIY Guidance**: Step-by-step instructions provided natively during the chat experience.
- [x] **FR-08 Anti-Litigation Guardrails**: Handled via Botpress system prompt constraints.
- [x] **FR-17 Conversation Transcript Storage**: Preserved in local DB to support webhooks and context handoff.
- [x] **FR-18 Multi-property support**: Homeowners can add/select multiple properties.

## 🎫 2. Ticket & Claim Management (Phase 1)
> Portal features for builder staff to manage warranties.
- [x] **FR-07 Claim lifecycle tracking**: Dashboard fully supports OPEN, IN_PROGRESS, RESOLVED, ESCALATED.
- [x] **FR-09 Human escalation with context**: Displays full handoff context (chat summary, issue details).
- [x] **FR-10 Builder Ticket Dashboard**: Real-time KPI cards, filtering, and status management.
- [x] **FR-13 Builder Knowledge Base**: Document tracking and uploading system.
- [x] **FR-14 Builder Company Info**: Branding, logo, and policy updates.
- [x] **FR-15 KPI Reporting**: Real-time resolution time, weekly trends, token analytics.
- [ ] **FR-16 Proactive status reminders**: Need to confirm Brevo status-change emails flow through per-company DB messaging config (not stale env SMTP).
- [ ] **FR-13/SRS 4.3.4 Citations**: Confirm "documents referenced in a ticket" is wired to real KB retrieval data.
- [ ] **Multi-Property Ticket Linkage**: Verify tickets link to correct property when homeowner has multiple (Testing Plan).

## 🔌 3. External Integrations & ERP Sync (FR-06 / FR-11)
> Syncing warranty tickets back to builder operational systems.
- [x] **ERP Connectors**: Builtopia, Buildertrend, Hyphen exist as REST clients in `erp-service.js`.
- [x] **Integration Configuration UI**: UI exists at `warranty/integrations/page.tsx` to configure API keys.
- [x] **Resolution Auto-Sync**: Auto-sync fires when a ticket is RESOLVED and on Botpress webhook.
- [ ] **Creation/Escalation Sync**: Trigger `syncTicketToERP` on ticket creation/escalation, not just resolution (SRS §4.2.7).
- [ ] **Failure Queuing (NFR 6.5)**: Queue + retry failed ERP writes up to 3× with backoff, raise alert, surface failure log in KPI dashboard.
- [ ] **Credential DB Loading**: Confirm ERP credentials are read from the DB integration record everywhere (remove `.env` fallbacks).
- [ ] **Full Integration Testing**: Test full loop of Builtopia sync status via external webhook.

## 🤖 4. Multi-Agent System (Phase 2 / SRS §5)
> The SRS specifies a custom Orchestrator + 7 sub-agents on LangGraph. Currently, this is fully offloaded to Botpress.
- [ ] **Decision needed**: Ratify "Botpress satisfies Phase 2" vs. build the SRS's orchestrated MAS. If keeping Botpress, explicitly record deviation from §5 so acceptance criteria 9-14 are re-scoped.
- [ ] **§5.8 Portal features (if MAS pursued)**: per-claim agent-step display, token breakdown, MAS-vs-workflow trigger config, Reviewer Agent toggle.

## 🔐 5. Security, NFRs & Architecture
- [x] **Botpress Embedded & Multi-Tenancy**: Dynamic Widget Generation injects `companyId` into payload.
- [x] **Role-Based Access Control (RBAC)**: Enforced strict scopes (Admin, Staff, Homeowner) in backend APIs.
- [x] **Secure Password Recovery**: Stateless client-side OTP validation flow.
- [ ] **NFR 6.3 Retention**: Configurable transcript retention (default 7 yrs) — confirm enforced, not just stored.
- [ ] **NFR 6.3 RBAC Data Scoping**: Verify warranty staff are scoped to assigned properties (not all-tenant) at the query layer.
