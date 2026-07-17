import "dotenv/config";
import express from "express";
import cors from "cors";

import { requireAuth, requireWorkspace } from "./middlewares/auth.js";
import authRouter from "./routes/auth.js";
import leadsRouter from "./routes/leads.js";
import complianceRouter from "./routes/compliance.js";
import salesforceRouter from "./routes/salesforce.js";
import campaignsRouter from "./routes/campaigns.js";
import calendarRouter from "./routes/calendar.js";
import kbRouter from "./routes/kb.js";
import appointmentsRouter from "./routes/appointments.js";
import segmentsRouter from "./routes/segments.js";
import csvRouter from "./routes/csv.js";
import salesDashboardRouter from "./routes/sales-dashboard.js";
import messagingSettingsRouter from "./routes/messaging-settings.js";
import schedulingRouter from "./routes/scheduling.js";
import newsRouter from "./routes/news.js";
import announcementsRouter from "./routes/announcements.js";
import automationsRouter from "./routes/automations.js";
import blogRouter from "./routes/blog.js";
import publicBlogRouter from "./routes/public-blog.js";

// Core Warranty Routes
import dashboardRouter from "./routes/dashboard.js";
import reportsRouter from "./routes/reports.js";
import ticketsRouter from "./routes/tickets.js";
import propertiesRouter from "./routes/properties.js";
import companyRouter from "./routes/company.js";
import knowledgeBaseRouter from "./routes/knowledge-base.js";
import integrationsRouter from "./routes/integrations.js";
import adminRouter from "./routes/admin.js";
import communitiesRouter from "./routes/communities.js";
import homeownersRouter from "./routes/homeowners.js";
import usersRouter from "./routes/users.js";
import deadLetterRouter from "./routes/dead-letter.js";

import { serve } from "inngest/express";
import { inngest } from "./lib/inngest.js";
import {
  runNurtureCampaign,
  handleCampaignExit,
} from "./inngest/functions/nurture.js";
import { handleCsvImport } from "./inngest/functions/csv-import.js";
import {
  appointmentSchedulingAgent,
  appointmentReminders,
} from "./inngest/functions/appointment.js";
import { scheduleCalendarItem } from "./inngest/functions/calendar.js";
import { scrapeNews } from "./inngest/functions/news-scraper.js";
import { sendAnnouncement } from "./inngest/functions/announcement.js";
import { ingestKbDocument } from "./inngest/functions/kb-ingest.js";
import {
  runAutomationRules,
  automationDateTriggers,
} from "./inngest/functions/automation.js";
import { salesforceSyncCron } from "./inngest/functions/salesforce-cron.js";

const app = express();
const port = process.env.PORT || 5000;

// Enable CORS with credentials support to proxy requests cleanly
app.use(
  cors({
    origin: process.env.NEXT_PUBLIC_URL || "http://localhost:3000",
    credentials: true,
  }),
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Route registrations
app.use("/api/auth", authRouter);

const salesGuard = [requireAuth, requireWorkspace("sales")];
app.use("/api/sales/leads", ...salesGuard, leadsRouter);
app.use("/api/sales/compliance", complianceRouter);
app.use("/api/sales/salesforce", salesforceRouter);
app.use("/api/sales/campaigns", ...salesGuard, campaignsRouter);
app.use("/api/sales/calendar", ...salesGuard, calendarRouter);
app.use("/api/sales/kb", ...salesGuard, kbRouter);
app.use("/api/sales/appointments", appointmentsRouter);
app.use("/api/sales/scheduling", schedulingRouter);
app.use("/api/sales/segments", ...salesGuard, segmentsRouter);
app.use("/api/sales/csv", ...salesGuard, csvRouter);
app.use("/api/sales/dashboard", ...salesGuard, salesDashboardRouter);
app.use(
  "/api/sales/settings/messaging",
  ...salesGuard,
  messagingSettingsRouter,
);
app.use("/api/sales/news", ...salesGuard, newsRouter);
app.use("/api/sales/announcements", ...salesGuard, announcementsRouter);
app.use("/api/sales/dead-letters", ...salesGuard, deadLetterRouter);
app.use("/api/sales/automations", ...salesGuard, automationsRouter);
app.use("/api/sales/blog", ...salesGuard, blogRouter);
// Public tenant-hosted blog reads (SW-BLOG-005) — intentionally unguarded.
app.use("/api/public/blog", publicBlogRouter);

const warrantyGuard = [requireAuth, requireWorkspace("warranty")];
app.use("/api/dashboard", ...warrantyGuard, dashboardRouter);
app.use("/api/reports", ...warrantyGuard, reportsRouter);
app.use("/api/tickets", ...warrantyGuard, ticketsRouter);
app.use("/api/properties", ...warrantyGuard, propertiesRouter);
app.use("/api/company", companyRouter);
app.use("/api/knowledge-base", ...warrantyGuard, knowledgeBaseRouter);
app.use("/api/integrations", integrationsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/communities", ...warrantyGuard, communitiesRouter);
app.use("/api/homeowners", ...warrantyGuard, homeownersRouter);
app.use("/api/users", usersRouter);
// Inngest Endpoint
app.use(
  "/api/inngest",
  (req, res, next) => {
    next();
  },
  serve({
    client: inngest,
    functions: [
      runNurtureCampaign,
      handleCampaignExit,
      handleCsvImport,
      appointmentSchedulingAgent,
      appointmentReminders,
      scheduleCalendarItem,
      scrapeNews,
      sendAnnouncement,
      ingestKbDocument,
      runAutomationRules,
      automationDateTriggers,
      salesforceSyncCron,
    ],
  }),
);

// Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date() });
});

// Check if running on Vercel or Test
if (process.env.VERCEL || process.env.NODE_ENV === "test") {
  console.log(
    "[Server] Running in Vercel/Test environment. Bypassing app.listen().",
  );
} else {
  app.listen(port, () => {
    console.log(`[Server] Standalone backend running on port ${port}`);
  });
}

// Export for Vercel serverless function
export default app;
