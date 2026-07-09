# AI4Home Warranty Care Portal — Remaining Work

This document tracks the **remaining** Warranty Workspace work against the **Ai.Lumen Warranty Care Agent SRS v1.0** (`Warranty_Care_Agent_SRS.pdf`). Completed items have been removed — only open/partial work is listed. Legend: `[~]` partial / deviation noted · `[ ]` not started. _(Last pruned 2026-07-09.)_

## 🎫 2. Ticket & Claim Management (Phase 1)
- [~] **FR-12 Agent prompt configuration (SRS §4.3.3)** — **delegated to Botpress**: the portal only injects **branding** into the widget config; the agent's system prompt, greeting, and escalation copy live in **Botpress Studio**, not the portal. The SRS's portal-side requirements — *editable prompt/greeting/escalation, saved named versions with rollback, and a preview/test mode* — are **not** in-repo. Record as an intentional deviation so QA doesn't test portal-side prompt versioning.
- [~] **FR-15 KPI Reporting**: the "survey-readiness score" in `reports.controller.js` is a **computed heuristic** (auto-resolution rate + speed; `activeSurveyCount` is hardcoded `0`) — it is **not** fed by real homeowner survey responses. Wire real CSAT input if the client expects true survey scores.
- [ ] **FR-16 Proactive status reminders**: Need to confirm Brevo status-change emails flow through per-company DB messaging config (not stale env SMTP).
- [ ] **FR-13/SRS 4.3.4 Citations**: Confirm "documents referenced in a ticket" is wired to real KB retrieval data.
- [ ] **Multi-Property Ticket Linkage**: Verify tickets link to correct property when homeowner has multiple (Testing Plan).

## 🔌 3. External Integrations & ERP Sync (FR-06 / FR-11)
- [ ] **Creation/Escalation Sync**: Trigger `syncTicketToERP` on ticket creation/escalation, not just resolution (SRS §4.2.7).
- [ ] **Failure Queuing (NFR 6.5)**: Queue + retry failed ERP writes up to 3× with backoff, raise alert, surface failure log in KPI dashboard.
- [ ] **Credential DB Loading**: Confirm ERP credentials are read from the DB integration record everywhere (remove `.env` fallbacks).
- [ ] **Full Integration Testing**: Test full loop of Builtopia sync status via external webhook.

## 🤖 4. Multi-Agent System (Phase 2 / SRS §5)
> **DECISION (ratified):** the entire warranty conversational workflow — intake, identify, diagnose, resolve, escalate — is **handled by Botpress**, which satisfies Phase 1 and, by agreement, stands in for the Phase 2 MAS. No custom LangGraph orchestrator will be built.
- [ ] **Record the deviation formally**: Note in the SRS/acceptance record that §5 (Orchestrator + sub-agents) and acceptance criteria 9–14 are **out of scope / re-scoped to Botpress** so QA does not test against them.
- [ ] **§5.8 portal features — descope confirmation**: per-claim agent-step display, per-agent token breakdown, MAS-vs-workflow trigger config, and Reviewer Agent toggle are **not applicable** under the Botpress decision. Confirm they can be dropped (or map token/step analytics to Botpress-provided data if the client still wants them).

## 🔐 5. Security, NFRs & Architecture
- [ ] **NFR 6.3 Retention**: Configurable transcript retention (default 7 yrs) — confirm enforced, not just stored.
- [ ] **NFR 6.3 RBAC Data Scoping**: Verify warranty staff are scoped to assigned properties (not all-tenant) at the query layer.
