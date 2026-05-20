# Warranty Care Portal - Implementation Tracker

## 🏗️ Technical Architecture Analysis (Current State)
* **Framework:** Next.js 16+ (App Router, Turbopack) with React 19.
* **Database:** Supabase PostgreSQL managed via Prisma 7.
* **Authentication:** Custom JWT/Context-based role system (ADMIN, STAFF, HOMEOWNER).
* **AI & Chat Integration:** Integrated Botpress Webchat dynamically via client-side script injection and iframe containers, replacing local LLM servers.
* **ERP Integration:** `erp-service.ts` features a production-ready HTTP Fetch client for Builtopia with Bearer token authentication, fully replacing the mock timeout simulations.

## ✅ Phase 0: Foundation (Complete)
- [x] **Database Schema**: Supabase + Prisma 7 with User, Company, Ticket, AgentConfig, and KB models.
- [x] **Authentication**: Secure login/signup system with role-based access.
- [x] **Ticket Dashboard (FR-10)**: Real-time KPI cards and recent tickets list.
- [x] **Ticket Management (FR-07)**: Full list view and individual ticket detail view.
- [x] **Company Configuration (FR-14)**: UI and API for managing builder profile and warranty policy.
- [x] **Agent Configuration (FR-12)**: Versioned management of system prompts, greetings, and escalations.
- [x] **Knowledge Base Management (FR-13)**: Document tracking system.
- [x] **ERP/CRM Connectors (FR-06/FR-11)**: Implemented robust REST `fetch` client in `erp-service.ts` for Builtopia integration.

## 🚧 Phase 1: Core Intelligence (Finalizing)
### High Priority (Mandatory)
- [x] **Homeowner Property Support (FR-18)**: Refactored schema to support multiple properties per user.
- [x] **Warranty Year Logic (FR-02)**: Automated Year 1/2/10 calculation based on Property COE Date.
- [x] **Botpress Webchat**: Embedded Botpress chatbot and injected official JS scripts to replace local RAG/Gemini.
- [x] **DIY Guidance Engine (FR-05)**: Extraction of step-by-step instructions via Gemini JSON output.
- [x] **Emergency Detection (FR-03)**: Gemini AI flagged automated escalation for life-safety issues.
- [x] **Human Escalation Handoff (FR-09)**: "Handoff Package" UI displaying full context.
- [x] **Conversation Transcript Storage (FR-17)**: Preserved conversational data models and ticket links to support external webhook integrations.

### Medium Priority (Logic & Analytics)
- [x] **Detailed KPI Reporting (FR-15)**: Real-time resolution time, weekly trends, and token consumption analytics.
- [x] **Status Notifications (FR-16)**: Integrated Brevo for automated email updates on ticket status changes.
- [x] **Secure Password Recovery**: Implemented stateless client-side OTP validation flow using Brevo to protect resources without database persistence.
- [x] **Botpress Ticket Escalation**: Created dedicated secure webhook integration API to receive Botpress escalations and conversation transcripts.
- [x] **Dynamic ERP Integrations**: Created a 3-card Admin management dashboard to save credentials directly to DB rather than `.env`.
- [x] **Role-Based Access Control (RBAC)**: Enforced strict role-based scopes (Admin, Staff, Homeowner) in backend APIs (Tickets, Dashboard, Company, Config, KB) and custom homeowner-focused dashboard client UI.
- [x] **Property Management Hub**: Implemented a comprehensive property management dashboard including a role-scoped client page (`/properties`), dynamic backend APIs (`/api/properties`), search filters, and an interactive property creation modal.
- [ ] **Anti-Litigation Guardrails (FR-08)**: Implement explicit system prompt constraints and "Reviewer" logic to prevent liability admissions.

## 🔮 Phase 2: Future MAS (Multi-Agent System)
- [ ] **Orchestrator Agent**: High-level routing agent for complex multi-part claims.
- [ ] **Specialized Agent Roster**: Build specialized agents for Diagnostics, Research, and ERP operations.
- [ ] **Quality Control**: Implement a "Reviewer Agent" workflow for human-in-the-loop verification (ties into Anti-Litigation).
- [ ] **Cost Breakdown**: Per-agent token consumption and cost tracking in the portal.

## 🛠️ Testing & Workflow
### Current Workflow
1. **Admin Setup**: Configure Company, Integrations, and Knowledge Base.
2. **Homeowner Claim**: User chats with AI -> AI checks Property COE -> AI injects KB -> AI provides DIY -> If unresolved/emergency, AI automatically generates Ticket + links Conversation.
3. **Staff Action**: Review tickets + transcript in Dashboard -> Update status -> Brevo emails Homeowner -> Syncs to ERP.

### Testing Plan
- [x] **Database Connectivity**: Verified Prisma schema sync and User authentication hashing.
- [x] **AI Intelligence Flow**: Verified Gemini JSON schema output for `createTicket` flags.
- [ ] **Multi-Property**: Verify tickets link to correct property when homeowner has multiple.
- [ ] **Integration**: Test full loop of Builtopia sync status via external webhook.
- [ ] **Notifications**: Verify Brevo email delivery on status change.
