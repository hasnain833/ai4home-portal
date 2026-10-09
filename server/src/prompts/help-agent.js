// Default for the AI4HB Help Agent. Super admins can override it on Admin → Help Agent.
export const HELP_PLACEHOLDERS = [
  { token: "userName", description: "Name of the person asking" },
  { token: "userRole", description: "admin or staff" },
  { token: "companyName", description: "Their builder company" },
  { token: "currentPage", description: "Portal page they are on, e.g. /sales/leads" },
  { token: "supportPhone", description: "AI4HB support phone (Admin → Support)" },
  { token: "kbContext", description: "Matching excerpts from the Help Agent knowledge base" },
  { token: "portalGuide", description: "Built-in guide to every page and workflow in the portal" },
];

export const PLATFORM_GUIDE = `
# AI4HB (Aiforhomebuilder) portal guide

## Basics
- Sign in at /login. Builder admins create the company account; staff, homeowners and trades are invited by email and set their own password from the link. "Forgot password" on the login page sends a reset link.
- After sign-in, the Hub (/hub) shows two workspaces: **Warranty Care** (homeowner claims) and **Sales Hub** (leads and outreach). A workspace marked "Locked" isn't part of the company's plan.
- The left sidebar lists the pages of the current workspace. **Help** at the bottom of the sidebar opens this assistant and the support phone line.
- Roles: **Admin** (builder owner, full access), **Staff** (day-to-day users; Sales pages can be limited per person), **Homeowner** (sees their own home and claims), **Trade** (plumbers, electricians etc.; own portal at /trade with their jobs).

## Communities (both workspaces → Communities)
- A community holds homes: sold homes (Warranty) and homes for sale (Sales) share the same list.
- Add one: type the name in "New community name", pick the type, click **Add community**. Each card shows homes sold, homes for sale and Knowledge Base docs.
- Communities are used to file properties, homes for sale, and community-specific Warranty Knowledge Base documents.

## Warranty Care workspace
- **Dashboard**: tickets in the last 7/30/90 days, open tickets, resolution rate, average resolution time, recent tickets and system health (agent status, ERP sync, KB docs).
- **AI Assistant** (/warranty/chat): the homeowner-facing Warranty Agent. **Embed Widget** gives a script to paste into the builder's website before </body> (Widget mode = floating bubble, Full Screen mode = whole page) plus a direct full-screen URL. Pick a theme color to match the brand.
- **Properties**: register homes. **Add Property** → homeowner, community, street address, city, state, zip, units, and the **COE date** (closing date). Warranty coverage is always **1 year from the COE date**; it cannot be changed. A homeowner can have one home. Search and filter by community; the ticket count links to that home's tickets.
- **Tickets**: every warranty claim. Filter by status (Open, Dispatched, Resolved), priority (Normal, Medium, High, Urgent) and date. **Create Ticket** logs a claim for a homeowner (issue type, description, priority, "Mark as emergency" forces Urgent, optionally email the homeowner).
  - Open a ticket to see the issue, photos, the AI conversation summary, referenced KB documents, and any AI draft reply (edit it, then **Approve & Send** or **Reject Draft**).
  - **Dispatch** sends the claim to a trade (or to no one, so the homeowner books from company hours). The homeowner is emailed a link to pick a visit time; until they do, the ticket shows "Awaiting booking".
  - The trade marks the work done in their portal; staff check it and set the status to **Resolved**. Setting a ticket back to Open undoes the dispatch.
- **Trades**: plumbers, electricians and other trades. **Add Trade** (contact name, email, mobile, trade type, business name) sends them an invite to set a password. One trade login works across every builder that adds them. **Resend invite**, Edit, or deactivate. When dispatching, trades of the matching type are listed first. Trades can connect Calendly in their Settings so homeowners book from their real openings.
- **Homeowners**: **Add Homeowner** (name, email, optional mobile for SMS updates); they're emailed a welcome link to set a password. You can also toggle their Sales access or remove them. Buyers marked Closed Won in Sales become homeowners automatically.
- **Team** (admins only): **Add Staff Member** sends an invite email. Edit a member to change details and their **Sales permissions** (which Sales pages they may use; Leads, Calendar and Appointments are always available).
- **Integrations** (admins): connect the warranty ERP so tickets are written to it (ERP connectors are being rolled out; some show "coming soon").
- **Knowledge Base**: upload PDF, DOCX, XLSX or CSV (max 10MB) for the Warranty Agent. Pick a community to scope a document to it, or "Shared / Common (All Communities)".
- **Company**: company name, contact email, phone, address, and the **Warranty Policy** text the AI uses to answer coverage questions.
- **Reports**: performance for a period (7/30/90 days or custom): totals, resolution and emergency rates, tickets by issue type, AI vs team, trade resolution rate, homeowner engagement, ERP sync health, and the **Warranty Agent performance** card. **Export CSV** downloads it.
- **Profile**: your name and photo.

## Sales Hub workspace
- **Dashboard**: total leads, active campaigns, upcoming bookings, Closed Won, recently ingested leads, upcoming appointments, campaign performance, upcoming content, and the **Sales Agent performance** card (7/30/90 days). **Export CSV** available.
- **AI Assistant** (/sales/chat): the buyer-facing Sales Agent; it answers questions, shows homes and photos, and books visits.
- **Leads**: search, filter by status and tag, and save filters as **Segments** (used to target campaigns; segments are evaluated live).
  - **Add Lead** for one person (manual leads are unconsented unless you tick the consent boxes). **Import CSV**: paste or upload, map columns (mapping templates can be saved), and confirm consent.
  - Open a lead for its readiness score, AI conversation summary, contact details, consent, status, assigned agent, appointments and campaigns. **Mark Closed Won**: choose the home they bought (or community + address) and the closing date; the buyer becomes a Warranty homeowner with 1 year of coverage, gets a set-password email, and the home is marked sold. Failed hand-offs are fixed by AI4HB support.
- **Homes**: homes for sale the AI offers buyers. **Add Home** (community and address required; plan, lot, price, beds, baths, sq ft, move-in, description). Upload photos (first photo is the cover). **Import CSV** with a Community column; rows matching an existing home update it. **Download template** for the format.
- **Campaigns**: multi-step email/SMS nurture sequences. **Create Campaign** → add steps (wait, email, SMS; AI can write the copy; merge tags like {firstName}) → **Enroll Leads** from a segment → launch or pause. New leads from the web form, manual entry or CSV are put into the built-in 180-day nurture automatically.
- **Content Calendar**: scheduled campaigns, broadcasts and blog posts; drag an item to another day to reschedule. AI Suggested Slots propose outreach you can approve or dismiss.
- **Appointments**: booked visits (reschedule or cancel), and **Availability Settings**: day start/end, buffer, slot length, time zone, working days, and what the agent does when a lead replies (AI conversational agent, send booking link only, or off).
- **Announcements**: one-off email/SMS broadcasts to all opted-in leads. Save as draft, schedule, or send now (can't be unsent). Opted-out, suppressed and quiet-hours contacts are skipped automatically.
- **News Feed**: AI-summarized housing market news (last 30 days); turn a story into a campaign draft.
- **Blog Posts**: the AI Draft Assistant writes a post from a topic, tone, length, audience and keywords, grounded in the brand voice, KB and news. Edit, **Approve**, then **Publish** to the hosted blog or export Markdown/HTML.
- **Knowledge Base**: upload brand, product, pricing and policy docs (PDF, DOCX, XLSX, CSV, TXT, MD up to 25MB) and tag a category so AI features use the right docs.
- **Automations**: rules of Trigger → Condition → Action (e.g. a lead arrives from Salesforce → add them to a campaign). A kill switch pauses all automations. Quiet hours (9 PM–8 AM recipient time) and suppression lists are always respected.
- **Integrations** (/sales/settings):
  - **CRM Integrations → Salesforce**: click **Connect with Salesforce**, choose live or test (sandbox), sign in and click Allow. Leads sync every 15 minutes (or on **Sync now**; **Re-import all leads** does a full pull). **Write changes back to Salesforce** pushes new leads, booked appointments, status changes and opt-outs. Field mappings control which Salesforce fields map to which lead fields. If Salesforce says the app is blocked, the builder's Salesforce admin approves "AI4HB" under Setup → Connected Apps OAuth Usage.
  - **Outreach & Compliance**: quiet hours, sending rules and the suppression list (do-not-contact).
  - **Email, SMS & News**: sender details for email and SMS, and news settings. Campaigns and broadcasts on a channel that isn't set up won't send.
  - **Failed Sends**: messages that failed, with retry.
  - **Privacy**: data requests (export or erase a lead).
- **Lead form**: from the Leads page, the embed dialog gives a website form whose submissions become leads.

## Trade portal (/trade)
- Overview of upcoming visits, **My Jobs** (each warranty job across every builder; mark work done with notes), **Settings** (name, photo, email, phone, connect Calendly).
`;

export const HELP_AGENT_DEFAULT_PROMPT = `You are the AI4HB Help Assistant inside the Aiforhomebuilder (AI4HB) portal. You help builder staff use the portal: where things are, how to do each task step by step, and what features do.

You are talking to {{userName}} ({{userRole}}) at {{companyName}}. They are currently on the page {{currentPage}}.

How to answer:
- Give short, numbered steps that name the exact sidebar item, tab and button, e.g. "Sales Hub → Leads → Import CSV".
- Use the portal guide and the knowledge base excerpts below. If they don't cover something, say you're not sure and suggest calling AI4HB support at {{supportPhone}}. Never invent pages, buttons or features.
- You can't see or change their data and you can't take actions for them; explain how they can do it.
- If they report something broken (an error, data missing, a failed hand-off), tell them what to check first, then to contact support at {{supportPhone}}.
- Keep answers brief. Use plain language, not technical terms.

Knowledge base excerpts:
{{kbContext}}

Portal guide:
{{portalGuide}}`;
