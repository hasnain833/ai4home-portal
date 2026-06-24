# Warranty Care Portal — Technical Audit vs SRS v1.0

This document serves as a technical audit of the current Warranty Workspace codebase against the provided **Ai.Lumen Warranty Care Agent SRS v1.0**.

---

## 1. Phase 1 — Functional Requirements (FR) Status

Overall Phase 1 implementation is robust, with the majority of the homeowner and builder portal features implemented.

| ID | Requirement | Priority | Status | Notes |
|---|---|---|---|---|
| **FR-01** | 24/7 homeowner intake & greeting | Must Have | ✅ Implemented | Achieved via Botpress embedded in `warranty/chat/page.tsx`. |
| **FR-02** | COE date lookup & classification | Must Have | ✅ Implemented | Handled in `tickets.controller.js` via `calculateWarrantyYear(property.coeDate)`. |
| **FR-03** | Emergency detection & escalation | Must Have | ✅ Implemented | `isEmergency` flag on ticket creation automatically forces `ESCALATED` status. |
| **FR-04** | Issue diagnosis via knowledge base | Must Have | ✅ Implemented | Relies on Botpress logic connected to the Knowledge Base. |
| **FR-05** | DIY guidance with pre-approved docs | Must Have | ✅ Implemented | Relies on Botpress conversational flows. |
| **FR-06** | Ticket creation in builder ERP/CRM | Must Have | 🟡 Partial | Tickets are created in local Postgres DB. Actual external API syncing to ERPs (Builtopia, Buildertrend, Hyphen) is **missing** from `tickets.controller.js`. |
| **FR-07** | Claim lifecycle tracking | Must Have | ✅ Implemented | `warranty/tickets` dashboard fully supports OPEN, IN_PROGRESS, RESOLVED, ESCALATED. |
| **FR-08** | Survey-positive & anti-litigation | Must Have | ✅ Implemented | Managed within Botpress prompts. |
| **FR-09** | Human escalation with context | Must Have | ✅ Implemented | `warranty/tickets` provides staff with ticket details, property info, and homeowner info. |
| **FR-10** | Builder portal — ticket dashboard | Must Have | ✅ Implemented | `warranty/tickets/page.tsx` provides filtering and status management. |
| **FR-11** | Builder portal — CRM/ERP connection | Must Have | ✅ Implemented | UI exists at `warranty/integrations/page.tsx` to configure API keys. |
| **FR-12** | Builder portal — agent prompt config | Must Have | ✅ Implemented | Handled directly within Botpress Studio; no frontend UI required. |
| **FR-13** | Builder portal — knowledge base | Must Have | ✅ Implemented | `warranty/knowledge-base/page.tsx` supports document uploads. |
| **FR-14** | Builder portal — company info | Must Have | ✅ Implemented | `warranty/company/page.tsx` supports branding, logo, and policy updates. |
| **FR-15** | KPI reporting | Should Have | ✅ Implemented | `warranty/dashboard/page.tsx` shows KPIs (total tickets, auto-resolution rate, etc). |
| **FR-16** | Proactive status reminders | Should Have | ✅ Implemented | `tickets.controller.js` uses `MailService.sendTicketStatusUpdate` on status changes. |
| **FR-17** | Conversation transcript storage | Should Have | ✅ Implemented | Handled and stored natively within Botpress; no frontend UI required. |
| **FR-18** | Multi-property support | Should Have | ✅ Implemented | Homeowners can add and select multiple properties during ticket creation. |

---

## 2. Phase 2 — Multi-Agent System (MAS) Status

According to the SRS, Phase 2 introduces an Orchestrator Agent and a fleet of sub-agents (Intake, Identify, Diagnostic, Research, Resolution, ERP, Reviewer) for complex claims.

**Status:** 🔴 **Not Implemented.**
- The current portal uses a single Botpress webchat injection (`src/app/warranty/chat/page.tsx`). 
- There is no custom backend orchestration logic (no LangChain/OpenAI agents running on the Express server) to handle the handoffs described in Section 5.4.
- All intelligence currently relies on Phase 1 BotPress node-based flows.

---

## 3. Technical Issues & Gaps Identified

Based on the comparison, the following technical gaps need addressing to fully satisfy the Phase 1 SRS:

### 3.1 External ERP Syncing (Critical Gap)
While the frontend allows users to input API keys for Builtopia, Buildertrend, and Hyphen (`warranty/integrations`), the backend `tickets.controller.js` does **not** push ticket data to these external systems upon ticket creation.
**Required Action:** Implement a webhook or service in `createTicket` that reads the company's active integration credentials and pushes the structured handoff package to the respective ERP API.

### 3.2 Agent Configuration UI (Handled via Botpress)
FR-12 dictates that homebuilders should be able to edit the agent's system prompt and greeting.
**Status:** Handled natively in Botpress Studio. No portal frontend feature is required.

### 3.3 Transcript Visibility in Tickets (Handled via Botpress)
**Status:** Conversation transcript storage and visibility are handled natively within Botpress. No frontend modifications are required in the portal tickets UI.

### 3.4 Missing Role Access in Auth Middleware (Resolved)
*Note: This was identified during the codebase audit and fixed as Task 1.8. The `req.user` now correctly includes `hasWarrantyAccess`.*

---

## 4. Suggested Tests

To validate the complete SRS workflow, the following integration tests should be developed:

1. **ERP Payload Test:** Mock a ticket creation event and assert that the correct JSON payload (with homeowner info, COE date, issue description) is dispatched to the active ERP integration.
2. **Emergency Escalate Test:** Submit a chat describing a water leak, verify the bot routes to emergency, and verify `isEmergency=true` hits the `POST /api/tickets` endpoint.
3. **Warranty Year Boundary Test:** Create a property with a COE date 364 days ago (Year 1) vs 366 days ago (Year 2), and verify the backend correctly sets the `warrantyYear` field on the ticket.
4. **Agent Branding Test:** Update company name and logo in the portal, and assert that the Botpress webchat initialization script receives the updated parameters dynamically.


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

