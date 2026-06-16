import "dotenv/config";
import express from "express";
import cors from "cors";

import authRouter from "./routes/auth.js";
import leadsRouter from "./routes/leads.js";
import complianceRouter from "./routes/compliance.js";
import salesforceRouter from "./routes/salesforce.js";
import sequencesRouter from "./routes/sequences.js";
import calendarRouter from "./routes/calendar.js";
import kbRouter from "./routes/kb.js";
import appointmentsRouter from "./routes/appointments.js";

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

import { NurtureRunner } from "./services/nurture-runner.js";

const app = express();
const port = process.env.PORT || 5000;

// Enable CORS with credentials support to proxy requests cleanly
app.use(
  cors({
    origin: process.env.NEXT_PUBLIC_URL || "http://localhost:3000",
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));

// Route registrations
app.use("/api/auth", authRouter);
app.use("/api/sales/leads", leadsRouter);
app.use("/api/sales/compliance", complianceRouter);
app.use("/api/sales/salesforce", salesforceRouter);
app.use("/api/sales/sequences", sequencesRouter);
app.use("/api/sales/calendar", calendarRouter);
app.use("/api/sales/kb", kbRouter);
app.use("/api/sales/appointments", appointmentsRouter);

// Core Warranty Route Mounts
app.use("/api/dashboard", dashboardRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api/properties", propertiesRouter);
app.use("/api/company", companyRouter);
app.use("/api/knowledge-base", knowledgeBaseRouter);
app.use("/api/integrations", integrationsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/communities", communitiesRouter);
app.use("/api/homeowners", homeownersRouter);
app.use("/api/users", usersRouter);

// Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date() });
});

app.listen(port, () => {
  console.log(`[Server] Standalone backend running on port ${port}`);
  
  // Start the background Nurture Sequence Poller (polls every 60s)
  NurtureRunner.startWorker(60000);
});
