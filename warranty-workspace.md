# AI4Home Warranty Care Portal — Warranty Workspace (REOPENED 🟡)

> # 🟡 WARRANTY WORKSPACE: MOSTLY BUILT — 4 GAPS REOPENED (2026-07-17)
>
> This document previously read **"feature-complete / no code gaps remain"** (closed out 2026-07-10). A full re-audit against `Warranty_Care_Agent_SRS.pdf` on **2026-07-17** found **four requirements marked done that are not met**, so the closeout is withdrawn. The workspace is still ~90% built — but it is not closed.
>
> | Category                                                                                                       | Status                                                                    |
> | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
> | Phase-1 portal features (ticket dashboard, ERP sync, company/widget config, KPI reporting, status reminders)   | ✅ **Built**                                                              |
> | ERP integration sync (create / escalate / resolve, retry + failure log)                                        | ✅ **Built**                                                              |
> | Security hardening (workspace gating, webhook auth, fail-closed secrets, at-rest secret encryption, audit-log) | ✅ **Built**                                                              |
> | **KB → agent indexing (§4.3.4 / FR-13)**                                                                       | ❌ **Not built** — uploads never reach the agent (see Reopened gaps)      |
> | **ERP visual field mapping (§4.3.2)**                                                                          | ❌ **Not built** — previously logged as "basic"; it is absent             |
> | **Per-property staff RBAC (§6.3)**                                                                             | ❌ **Not built** — a SHALL, previously logged as "optional future"        |
> | **Data retention policies (§6.3 / §8.1)**                                                                      | ❌ **Not built** — 7-year transcript/ticket retention unimplemented       |
> | Conversational bot / AI (intake, diagnosis, escalation, Phase-2 MAS)                                           | 🤖 **By design in Botpress** — not a portal deliverable                   |
> | Live ERP sandbox test / `AuditLog` DB activation                                                               | ⚙️ **Operational step** (one command / needs sandbox keys) — code is done |
>
> Full requirement-by-requirement detail is in the **SRS verification matrix** at the bottom.

This document tracks the Warranty Workspace against the **Ai.Lumen Warranty Care Agent SRS v1.0** (`Warranty_Care_Agent_SRS.pdf`). For the sales side see [`sales-workspace.md`](./sales-workspace.md).

_Last updated: 2026-07-17 (full SRS-vs-code re-audit; closeout withdrawn)._

## 🔴 Reopened gaps (2026-07-17 re-audit)

- [ ] 🔴 **§4.3.4 / FR-13 — Uploaded KB documents never reach the agent.** SRS:
      "Uploaded documents **SHALL be indexed and made available to the agent for
      retrieval during diagnosis**", and go-live criterion §9.1.5: "Knowledge base
      documents are uploaded, indexed, and retrievable by the agent within 5 minutes
      of upload." **Reality:** `knowledge-base.controller.js` uploads the file to
      Supabase and writes a `KnowledgeBaseDocument` row — that is all. No chunking, no
      embedding, no push to Botpress. `KnowledgeBaseDocument` is referenced in exactly
      two places in the whole codebase: that controller and a dashboard count
      (`dashboard.controller.js:58`). `bp-config/route.ts` injects **branding only**
      (color / name / logo). The agent's knowledge base lives entirely inside Botpress
      and is populated there by hand.
  - **This is a live trap, not just a doc error:** a builder uploading a warranty
    policy in the portal will reasonably believe the agent now knows it. It does
    not, and nothing tells them otherwise.
  - Decide one of:
    - [ ] **Build portal → Botpress KB sync** (upload pushes the doc into the bot's
          KB via the Botpress API; track per-doc sync status; handle delete/re-sync), or
    - [ ] **Relabel the page as a document library** with an explicit banner stating
          the agent's KB is managed in Botpress — and keep the two in sync by process.
  - Note the earlier ✅ on FR-13 was not baseless: 3 of §4.3.4's 4 bullets _are_
    met (upload PDF/DOCX/TXT; add/remove/update; show referenced docs per ticket via
    `Ticket.kbReferences`, which Botpress sends back). Only the indexing bullet —
    the one that makes the feature real — is missing.
- [ ] 🔴 **§4.3.2 — No ERP visual field-mapping interface.** SRS: "Admins SHALL be
      able to map agent claim fields to ERP fields via a visual field-mapping
      interface." This was previously logged as "visual field-mapping UI is basic" —
      it is **absent**. The `Integration` model (`prisma/schema.prisma:124`) stores
      credentials/SMTP only; there is no mapping table, column, or UI for ERP. (The
      `SalesforceFieldMapping` model is **Sales-workspace only** and does not apply to
      Builtopia/Buildertrend/Hyphen.)
- [ ] 🔴 **§6.3 — Per-property staff RBAC not implemented.** SRS: "RBAC **SHALL**
      ensure warranty staff see only their assigned properties." No
      `assignedProperty` / property-scoping construct exists anywhere in the schema or
      route guards — any STAFF user sees every ticket in the tenant. Previously filed
      as an "optional future enhancement (product decision, not a gap)"; it is a SHALL,
      so it is a gap. Company-level tenant isolation _is_ enforced — the gap is
      **within** a tenant.
- [ ] 🟡 **§6.3 / §8.1 — Retention policies not implemented.** SRS requires
      transcripts retained "for a configurable period (default: **7 years**) to support
      warranty litigation defense", tickets "7 years minimum", homeowner records
      "duration of warranty + 3 years". No retention configuration, no archival, no
      purge job exists. Largely moot for transcripts while Botpress holds them (confirm
      **Botpress's** retention meets 7 years — that is now a contractual dependency),
      but ticket/homeowner retention is ours and is unaddressed.

## ✅ Confirmed still built (re-verified 2026-07-17)

- **Shipped:** ERP create/escalate/resolve sync + 3× retry/backoff + failure log + dashboard surfacing; Botpress ticket-webhook auth + fail-closed secrets; FR-16 status emails on Botpress-driven changes; workspace route gating; Super-Admin session hardening; **ERP secret encryption at rest**; **audit-log** (`AuditLog` + helper); multi-property + credential-loading verified.
- **Operational steps (not code, do when convenient):** run `prisma db push` to activate the `AuditLog` table; set a strong `APP_ENCRYPTION_KEY`; run a live ERP sandbox test with real vendor keys.
- **Genuinely optional (product decisions, not gaps):** true CSAT survey capture (FR-15 currently uses a survey-readiness heuristic).

## 📋 Warranty SRS v1.0 — feature verification (2026-07-10)

> Every requirement in `Warranty_Care_Agent_SRS.pdf` checked against the code. Legend: ✅ built · 🤖 Botpress (by design, portal not responsible) · ⚠️ built with a noted deviation · ⏳ code done, migration/decision pending · ❌ not built.

**Phase 1 functional requirements (SRS §4.5)**
| ID | Requirement | Status | Where / note |
|----|-------------|--------|--------------|
| FR-01 | 24/7 intake & greeting | 🤖 | Botpress conversation flow |
| FR-02 | COE lookup + warranty-year classification | ✅ | `lib/utils.calculateWarrantyYear`, applied in `tickets`/`integrations` controllers |
| FR-03 | Emergency detection + immediate escalation | 🤖✅ | Botpress detects; portal sets `isEmergency`→`ESCALATED`+`URGENT` |
| FR-04 | Issue diagnosis via KB | 🤖 | Botpress RAG |
| FR-05 | DIY guidance w/ pre-approved docs | 🤖 | Botpress |
| FR-06 | Ticket creation in ERP/CRM | ✅ | `syncTicketToERP` on create/escalate/resolve (fixed this pass) |
| FR-07 | Claim lifecycle tracking | ✅ | `Ticket.status` OPEN/IN_PROGRESS/RESOLVED/ESCALATED; dashboard |
| FR-08 | Survey-positive / anti-litigation language | 🤖 | Botpress prompt guardrails |
| FR-09 | Human escalation w/ full context | 🤖✅ | Botpress handoff; portal stores `chatSummary`/`extractedInfo`/`kbReferences` |
| FR-10 | Portal ticket dashboard | ✅ | `src/app/warranty/tickets` (+ status/date/property/type filters) |
| FR-11 | Portal CRM/ERP connection mgmt | ✅ | `src/app/warranty/integrations` + `integrations.controller` (test/save/delete, health, masked keys) |
| FR-12 | Portal agent prompt config | 🤖⚠️ | **Deviation:** prompt/greeting/escalation in Botpress Studio; portal injects branding only |
| FR-13 | Portal KB management | ⚠️❌ | **Downgraded 2026-07-17.** Upload / list / delete ✅ (`src/app/warranty/knowledge-base`); referenced-docs per ticket ✅ (`Ticket.kbReferences`, sent by Botpress). **But §4.3.4's indexing bullet is not met — uploads are never indexed or passed to the agent.** See Reopened gaps. |
| FR-14 | Portal company-info config | ✅ | `src/app/warranty/company` + `company.controller` (name, logo, botColor, warrantyPolicy, contact) |
| FR-15 | KPI reporting | ⚠️ | `reports.controller` — real ticket metrics + ERP health; survey-readiness heuristic (no true CSAT capture) |
| FR-16 | Proactive status reminders | ✅ | Emails on portal + Botpress status changes via per-company Brevo (fixed this pass) |
| FR-17 | Conversation transcript storage | 🤖⚠️ | Full transcripts in Botpress; portal keeps `chatSummary`/`extractedInfo` |
| FR-18 | Multi-property / multi-household | ✅ | `Property` per homeowner; ticket→property linkage enforced |

**Phase 1 portal detail (SRS §4.3)** — dashboard §4.3.1 ✅ · ERP config §4.3.2 ⚠️ **connect/health/test ✅ but the visual field-mapping interface is absent, not "basic"** (corrected 2026-07-17) · agent config §4.3.3 🤖⚠️ · KB mgmt §4.3.4 ❌ **indexing bullet unmet — uploads never reach the agent** (corrected 2026-07-17) · company info §4.3.5 ✅ · widget branding + embed (name/logo/colour/offers) ✅ `bp-config` / `widget/[companyId]` / `widget.js`.

**Phase 2 — Multi-Agent System (SRS §5)** — 🤖 **Re-scoped to Botpress (ratified).** Orchestrator + 6 sub-agents, per-agent token/step breakdown (§5.8), Reviewer toggle: **not built portal-side by design.** Acceptance criteria 9–14 are out of scope here.

**Non-functional (SRS §6)** — §6.1 perf ✅ (indexed, tenant-scoped) · §6.2 availability 🤖/infra · §6.3 encryption ✅ (ERP creds now AES-256-GCM at rest; TLS in transit) · §6.3 audit ✅ (`AuditLog` + helper; ⚙️ activate with `prisma db push`) · §6.3 RBAC ⚠️ **company-scoped ✅ / cross-tenant prevented ✅, but per-property staff scoping is a SHALL and is not built** (corrected 2026-07-17) · §6.3 retention ❌ (7-year transcript/ticket retention unimplemented) · §6.4 scalability ✅ (plugin ERP connectors, KB 50MB/10GB) · §6.5 reliability ✅ (ERP 3× retry/backoff + alert row) · §6.6 usability ✅.

**Net (revised 2026-07-17):** 🟡 **The warranty workspace is close, but not complete.** The ticketing, ERP-sync, security and reporting spine is genuinely built and re-verified. Four requirements previously marked done are **not met** and are reopened above: KB→agent indexing (§4.3.4/FR-13), ERP visual field mapping (§4.3.2), per-property staff RBAC (§6.3), and data retention (§6.3/§8.1). All bot/AI behaviour remains owned by Botpress by design — but note that this is exactly what hides the FR-13 gap: because the agent _does_ answer from a knowledge base, the portal KB page looks like it works when it is not connected to anything.

**Why the earlier closeout was wrong (so it doesn't recur):** the 2026-07-10 pass verified that each _page and model existed_ rather than that each _SRS bullet was satisfied end-to-end_. FR-13 has four bullets and three pass — checking the feature at page level reads as ✅. The lesson for the next audit: trace each requirement to the code path that fulfils it, and for anything that claims to feed the agent, follow the data all the way to the agent.
