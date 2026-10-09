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

## Questions for the client
- [ ] Which warranty ERP does the first builder use? Can we get API access?
- [ ] What is the support phone number?
- [ ] What counts as "closed" for the hand-off: a Salesforce Opportunity stage, or a home status?
