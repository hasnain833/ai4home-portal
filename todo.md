# TODO: Client onboarding SOP (Oct 6, 2026)

Engineering work from "SOP: Onboarding a New Client and New Communities".

## 1. Integrations naming
- [x] Both agents have a page labelled **Integrations** (client decision)
  - [x] Sales: nav item and page heading renamed from "Settings" to "Integrations" (URL is still `/sales/settings`)
  - [x] Warranty: Integrations page restored at `/warranty/integrations` using `ErpIntegrationsCard`, and the ERP tab removed from Sales

## 2. Portal links in the builder's systems
- [x] Salesforce: create a Lead for new portal leads (AI chat booking, web form, manual entry)
- [x] Salesforce: write booked appointments as Events (moved on reschedule, deleted on cancel)
- [x] Add a link to the AI4HB lead on every Lead and Event we write (in the Description field)
- [ ] ERP: add a link to the AI4HB ticket in the ticket payload

## 3. Help / support
- [x] Add a **Help** button to the sidebar (Warranty and Sales) that opens a menu with the chatbot link and support phone. Reads the stored platform setting.
- [x] Show the support phone number and chatbot link on the Communities page (both workspaces)
- [x] Store the support phone number as a platform setting, editable on Admin → Support (placeholder values until the client sends the real number)

## 4. New communities (Part B)
- [ ] Sync communities from Salesforce into the portal
- [ ] Sync communities from the ERP (once a connector is live)
- [ ] Let Sales KB documents be scoped to a community (only Warranty KB supports this today)
- [ ] Guided "add community" flow for builders: warranty terms, trades, warranty contact, pricing, features, site plan, marketing, sales staff

## 5. Sales-to-warranty hand-off
- [x] "Mark Closed Won" on the lead page: makes the buyer a Warranty homeowner and property (1-year coverage) and emails them a set-password link
- [x] Mark the SalesHome as SOLD so the Sales Agent stops offering it
- [x] Exception report: failed hand-offs show in Admin > Hand-off Issues (retry / resend welcome email / mark resolved)
- [ ] Automatic trigger from Salesforce (e.g. Opportunity Closed Won)

## 6. Reports (Part C metrics)
- [x] Warranty: "Warranty Agent performance" card on Warranty → Reports (follows the page's period filter, included in CSV export):
  inquiries handled / diagnosed / resolved by AI, tickets written to ERP (shows "—" until an ERP is live),
  claims dispatched, reminders to homeowners and trades, appointment kept rate, appointments rescheduled,
  first-visit resolution rate
- [x] Sales: "Sales Agent performance" card on the Sales dashboard (7/30/90 days): interactions, nurtured touches,
  booked appointments, new leads, success rate (new leads that booked)
- [x] Onboarding time to go-live: contract-signed and go-live dates per company on Admin → Companies, with "Live in N days" / "Day N of 30"
- Note: "Appointments rescheduled" only counts moves made after this change; earlier moves were never recorded and can't be recovered.

## 7. AI4HB Help Agent
- [x] Customer-service chatbot for builder staff (portal how-to, uploading communities). Needs its own prompt and KB.
  - Help → "Ask the AI assistant" (also on Communities). Built-in prompt with a full portal guide; super admins edit the prompt, test it and upload docs on Admin → Prompt Lab → Help Agent.
  - [ ] DB: run `prisma/sql/2026-10-09-kbscope-help.sql`, then `prisma db push` (adds the `HELP` KB scope). Until then, doc uploads fail; chat works without docs.

## 8. ERP write-back (blocked)
- [ ] Get ERP name and sandbox/API credentials from the client
- [ ] Build the real connector for that ERP and remove it from `COMING_SOON_PLATFORMS`
- [ ] Pull homeowners from the ERP

## 9. Ticket management + staff roles (Oct 8–9, 2026)
- [x] Complete the task/ticket management system in AI4HB
- [x] Add staff roles for Super Admin users
- [x] Both regular staff and Super Admin staff can create and resolve tickets

## 10. Trades (Oct 8–9, 2026)
- [x] Separate auth role for trades (plumbers, electricians, etc.): `TRADE` role, own portal at `/trade`, API fenced to `/api/trade/*`
- [x] CRUD for trades: Warranty → Trades (one login shared across builders; each builder keeps its own list)
- [x] Trades selectable and assignable when dispatching a ticket (matching trade type listed first)
- [x] Trade marks "work done"; staff checks and resolves
- [x] Staff, homeowners and trades get a set-password invite email instead of an admin-typed password
- [x] Trade portal uses the standard sidebar: Overview, My Jobs, Settings (name, photo, email, phone, Calendly)
- [x] Dispatch assigns trades only (or no one); staff are no longer offered
- [x] Homeowner books from the trade's Calendly event type openings; booked/moved/cancelled in Calendly too (trade needs a paid Calendly plan)
- [x] Calendly → portal sync: webhook `/api/webhooks/calendly` applies cancels and reschedules made in Calendly (subscribed per trade on connect)
- [x] Trades connect Calendly (Trade → Settings); their Calendly busy times are hidden from the homeowner's booking page
- [x] Set-password links now open our own page (`/forgot-password/update?token_hash=...`) instead of bouncing via Supabase's Site URL
- [x] Register a Calendly OAuth app (scopes: users:read availability:read event_types:read scheduled_events:write webhooks:write; set CALENDLY_WEBHOOK_SIGNING_KEY), set `CALENDLY_CLIENT_ID` / `CALENDLY_CLIENT_SECRET`, redirect URI `<NEXT_PUBLIC_URL>/api/trade/calendly/callback`
- [x] DB: run `prisma/sql/2026-10-08-trade-role.sql`, then `prisma db push` (adds `CompanyTrade`, `CalendlyConnection`, `Ticket.workDone*`)
- [ ] Set the 3 CALENDLY_* vars in the production (Vercel) environment too
- [ ] Test end to end on staging: add trade → invite → dispatch → book → mark done → resolve

## 11. Google Drive: Working Documents (Oct 8–9, 2026)
- [x] Create a "Working Documents" folder in ghulamali9020's Google Drive
- [x] Upload the latest SRS for the mobile app
- [x] Upload the Daily Updates document
- [x] Upload Changes to Contract (Terms and Conditions)

## 12. Before the next deploy (Oct 15, 2026)
- [ ] **`npx prisma db push`**: adds `RateLimit` (shared rate limiter) and `Company.suspendedAt` (Suspend). **Required:** the login check reads `suspendedAt`, so every tenant login fails until this runs.
- [ ] Commit, especially the files in folders that have been wiped before: `server/src/money-paths.test.js`, `prisma/sql/kb-indexes.sql`, `audit.md`
- [ ] Suspend a test company, try logging in as one of its users, then reactivate
- [ ] Click through Warranty → Tickets / Properties: the create-ticket and property dropdowns now come from the shared cache
- [ ] Run `npm test` (9 money-path tests)

## 13. B2B nurture (client request, due Fri Oct 16)
- [x] **Write with AI** on each step in Super Admin → Campaigns: type a topic → AI writes the subject + body (email) or the text (SMS); "Rewrite with AI" improves an existing draft. Only describes features in the portal guide; nothing is saved until Save.
- [x] Saving a campaign rejects unknown placeholders (e.g. `{{lastName}}`) so builders never see literal `{{…}}`
- [ ] Before the demo: try the button in the browser, then send one campaign to our own email and phone (check booking link + opt-out line)
- [ ] Phase 2, only if the client wants a true agent: each builder gets different content, picked per lead from homebuilder industry news + AI4Home case studies (needs 3–5 case studies/articles from the client for the KB)

## 14. Nurture analytics (client request)
Probably the **tenant** 180-day nurture (to confirm). Today we only have outcome counts (enrolled / replied / booked / opted out); nothing records which message went to whom or whether it was opened or clicked.
- [ ] Message event log: one row per send, tied to campaign, step and lead (sent / delivered / failed)
- [ ] Email open tracking (pixel) and click tracking (redirect links)
- [ ] Record replies and bookings against the step that produced them (inbound handlers already exist)
- [ ] Dashboard: funnel per campaign (sent → opened → clicked → replied → booked), per-step performance, trend over time, time-to-book
- [ ] Tell the client: Apple Mail pre-loads pixels, so opens run high; clicks, replies and bookings are the reliable numbers
- Estimate: 2–3 days. The same event log can serve B2B campaigns later at little extra cost.

## 15. Sales training agent, "Sales Coach" (client request)
Separate from the existing Sales Agent (which talks to home buyers).
- [ ] Role-play: the salesperson picks a scenario (first-time buyer worried about payment, comparing resale, "just looking"…); AI plays the buyer with realistic objections from the builder's real homes, communities and incentives (Sales KB + homes list)
- [ ] Scorecard at the end: discovery questions, objection handling, asking for the appointment, plus specific feedback
- [ ] Save sessions so a manager can see progress
- [ ] Prompt editable in Prompt Lab (reuse the Help Agent pattern)
- Estimate: 2–3 days once the questions below are answered.

## 16. Super Admin staff, "Super Staff" (client request)
Today Super Admin access is all-or-nothing (`isSuperAdmin`, ~50 checks) with no invite flow. Note: item 9 above is ticked "staff roles for Super Admin users", but there is no such role in the schema (roles: SUPER_ADMIN, ADMIN, STAFF, HOMEOWNER, TRADE).
- [ ] New `SUPER_STAFF` role (enum edit → hand-written SQL, then `db push`)
- [ ] Super Admin invites by email → set-password link (reuse the existing invite helper)
- [ ] Per-area permissions per person, e.g. Companies (view / suspend), B2B leads & campaigns, Appointments, Prompt Lab, Costs, Support (reuse the Sales-permissions pattern)
- [ ] Replace the yes/no Super Admin checks with per-permission checks on every admin page and API; hide pages they can't use
- [ ] Only the Super Admin can add, edit or remove staff
- Estimate: 1.5–2 days.

## 17. Admin → Companies (Oct 15, 2026)
- [x] Removed the Users and Joined columns (we list tenants, not their users)
- [x] Suspend / Reactivate (no delete): blocks the company's logins, website chat and lead form, and stops all its emails and texts; the 180-day nurture pauses without losing steps. Logged in the audit log. Nothing is deleted.
- [ ] Later: "Create company" with admin invite (deferred by decision)
- [ ] Later, if needed: edit company details (name, email, phone, address)

## 18. Technical audit leftovers (see `audit.md`)
- [ ] Move the AI embedding model out of the API function (e.g. a hosted embeddings API); needs a cost/infra decision
- [ ] Move the main Tickets / Properties / Homeowners lists onto `useQuery` when those pages are next reworked
- [ ] Once companies have many of their own KB chunks: add `SET LOCAL hnsw.iterative_scan = strict_order` per semantic query (Supabase blocks setting it database-wide)
- [ ] More tests: nurture send flow, Closed Won hand-off

## Questions for the client
- [ ] Which warranty ERP does the first builder use? Can we get API access?
- [ ] What is the support phone number?
- [ ] What counts as "closed" for the hand-off: a Salesforce Opportunity stage, or a home status?
- [ ] Nurture analytics: tenant nurture, B2B campaigns, or both?
- [ ] Sales Coach: for builders' salespeople inside the portal (product feature), or for AI4Home's own team?
- [ ] Sales Coach: role-play a buyer and score the salesperson, or a Q&A coach ("how do I handle this objection")?
- [ ] B2B: can you send 3–5 case studies or articles about AI4Home for the agent's knowledge base?
- [ ] Super Staff: what can they do? All Super Admin pages except managing staff, or a tick-box list per person?
- [ ] Super Staff: which actions stay Super Admin-only regardless (e.g. suspending companies, Prompt Lab "Set Live", messaging pricing)?
