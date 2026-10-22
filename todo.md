# TODO: Client onboarding SOP (Oct 6, 2026)

Engineering work from "SOP: Onboarding a New Client and New Communities".

## 2. Portal links in the builder's systems
- [ ] ERP: add a link to the AI4HB ticket in the ticket payload


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


## 8. ERP write-back (blocked)
- [ ] Get ERP name and sandbox/API credentials from the client
- [ ] Build the real connector for that ERP and remove it from `COMING_SOON_PLATFORMS`
- [ ] Pull homeowners from the ERP


## 13. B2B nurture (client request, due Fri Oct 16)
- [ ] Phase 2, only if the client wants a true agent: each builder gets different content, picked per lead from homebuilder industry news + AI4Home case studies (needs 3–5 case studies/articles from the client for the KB)

## 14. Nurture analytics (client request)
Tenant Sales workspace (confirmed). Tracking only starts from Oct 16, 2026; earlier sends can't be backfilled.
- [x] Message log: no new table; `MessageUsage` gained lead / campaign / step / provider-id columns plus delivered / opened / clicked / failed / replied / booked timestamps
- [x] Email opens and clicks: Brevo's own tracking via a webhook (`POST /api/sales/compliance/events/email`), not our own pixel; Apple proxy opens ignored
- [x] SMS delivered / failed from Telnyx `message.finalized` on the existing inbound webhook
- [x] Replies and bookings credited to the lead's last campaign message
- [x] Page `/sales/campaigns/[id]/analytics`: funnel, per-step table, daily trend, median time to book, refresh button. Linked from each campaign, the 180-day workflow and the dashboard
- [x] Sales dashboard cleaned up: one row of 5 numbers with a single period toggle; "Last sync" date removed
- [ ] Brevo: turn on open/click tracking and add the events webhook with `INTEGRATION_WEBHOOK_SECRET`
- [ ] Check in production that delivered / opened / clicked numbers fill in
- [ ] Tell the client: opens are approximate (Apple Mail, link scanners); replies and bookings are the reliable numbers
- [ ] Later, if asked: SMS click tracking (redirect links), and B2B campaigns on the same columns

## 15. Sales training agent, "Sales Coach" (client request)
Separate from the existing Sales Agent (which talks to home buyers).
- [ ] Role-play: the salesperson picks a scenario (first-time buyer worried about payment, comparing resale, "just looking"…); AI plays the buyer with realistic objections from the builder's real homes, communities and incentives (Sales KB + homes list)
- [ ] Scorecard at the end: discovery questions, objection handling, asking for the appointment, plus specific feedback
- [ ] Save sessions so a manager can see progress
- [ ] Prompt editable in Prompt Lab (reuse the Help Agent pattern)
- Estimate: 2–3 days once the questions below are answered.

## 16. Super Admin staff, "Super Staff" (client request)
- [x] New `SUPER_STAFF` role and `adminPermissions` on User (SQL in `prisma/sql/2026-10-16-super-staff-role.sql`, then `db push`)
- [x] Admin > Staff: Super Admin invites by email (set-password link), edits access, resends the invite, removes. Changes are audit-logged
- [x] Tick-box areas per person: view companies, manage companies, B2B, appointments, CRM & News, hand-offs, support, costs, Prompt Lab
- [x] Every admin API route checks its area (`requireAdmin`); unguarded handlers stay Super Admin-only. Nav hides pages they can't use; view-only staff don't see company actions
- [x] Only the Super Admin can add, edit or remove staff
- [x] Fixed: `/api/admin/sales-agent-appointments` had no access check at all
- [x] Staff sign in on the normal `/login` (not the Super Admin login); try an invite end to end
- [x] Decide with the client if any action should stay Super Admin-only beyond staff (suspend, Prompt Lab "Set Live", pricing); today the area tick covers them


## Questions for the client
- [ ] Which warranty ERP does the first builder use? Can we get API access?
- [ ] What is the support phone number?
- [ ] What counts as "closed" for the hand-off: a Salesforce Opportunity stage, or a home status?
- [x] Nurture analytics: tenant nurture, B2B campaigns, or both? Tenant Sales workspace
- [x] Sales Coach: for builders' salespeople inside the portal (product feature), or for AI4Home's own team? AI4Home's own team first; repurposing for builders is a stub (SRS v1.1, docs/AI4HB-Sales-Coach-SRS.pdf)
- [x] Sales Coach: role-play a buyer and score the salesperson, or a Q&A coach ("how do I handle this objection")? Both, text only; training areas: products, AI, homebuilding business, executive sales
- [ ] B2B: can you send 3–5 case studies or articles about AI4Home for the agent's knowledge base?
- [x] Super Staff: what can they do? Built as a tick-box list per person (default; confirm with the client)
- [ ] Super Staff: which actions stay Super Admin-only regardless (e.g. suspending companies, Prompt Lab "Set Live", messaging pricing)?
