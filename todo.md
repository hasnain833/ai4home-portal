# Project Status & TODO List (Based on SRS v1.0)

## ✅ Phase 1: Completed Tasks
- [x] **Database Foundation**: Prisma schema defined and synced with Supabase.
- [x] **Authentication**: Secure login/signup system with role-based access (Admin, Staff, Homeowner).
- [x] **Ticket Dashboard (FR-10)**: Real-time KPI cards and recent tickets list.
- [x] **Ticket Management (FR-07)**: Full list view with filtering by status, priority, and year.
- [x] **Company Configuration (FR-14)**: UI and API for managing builder profile and warranty policy.
- [x] **Agent Configuration (FR-12)**: Versioned management of system prompts, greetings, and escalations.
- [x] **Knowledge Base Management (FR-13)**: Document upload/tracking system (CRUD operations).
- [x] **Mock Data Removal**: All major pages converted from static arrays to real database fetching.

## 🚧 Phase 1: Remaining Tasks
### High Priority (Core Functionality)
- [ ] **Homeowner COE Data (FR-02)**: Update `User` model and UI to track "Certificate of Escrow" dates for warranty year logic.
- [ ] **AI Agent Integration (FR-01)**: Connect the portal to the conversational engine (BotPress or custom LLM).
- [ ] **RAG Implementation (FR-04)**: Index uploaded KB documents into a vector store (Pinecone/Weaviate) for AI retrieval.
- [x] **ERP/CRM Connectors (FR-06/FR-11)**: Build the actual API integrations for Builtopia, Buildertrend, and Hyphen.

### Medium Priority (Logic & Analytics)
- [ ] **Emergency Detection (FR-03)**: Implement logic to flag life-safety issues and trigger human escalation.
- [ ] **Detailed KPI Reporting (FR-15)**: Implement token cost tracking, auto-resolution rates, and survey scoring logic.
- [ ] **DIY Guidance Engine (FR-05)**: Map KB documents to specific "Self-Fix" instructions for the agent.
- [ ] **Human Escalation Handoff (FR-09)**: Create the "Handoff Package" UI for staff to see conversation transcripts.

### Low Priority (Polish)
- [ ] **Status Reminders (FR-16)**: Implement automated email/SMS notifications for ticket updates.
- [ ] **Multi-Property Support (FR-18)**: Allow homeowners to manage multiple addresses under one account.

## 🔮 Phase 2: Future MAS (Multi-Agent System)
- [ ] **Orchestrator Agent**: Implement logic to route complex claims between sub-agents.
- [ ] **Specialized Agent Roster**: Build Identify, Diagnostic, Research, and ERP sub-agents.
- [ ] **Quality Control**: Implement the "Reviewer Agent" toggle for pre-delivery verification.
