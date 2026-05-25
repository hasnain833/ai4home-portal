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
- [ ] **ERP Sync Status Display (SRS 4.3.1)**: Update the ticket detail page to visually display the `erpSyncStatus` and `erpReferenceId`.
- [ ] **Staff Property Assignment RBAC (SRS 6.3)**: Create database relation mapping Staff to specific Properties, and enforce that Staff only see tickets for their assigned properties.
- [ ] **API Credential Encryption (SRS 6.3)**: Implement encryption/decryption (AES-256) for CRM/ERP API credentials before saving them to the database (currently stored in plaintext).
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
- [ ] **Agent Step Tracking (SRS 5.8)**: Update the portal to display which specific agent handled each claim step (Intake, Diagnostic, Resolution, ERP) on the ticket detail view.

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
