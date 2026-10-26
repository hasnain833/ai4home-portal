import express from "express";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import { getHelpAgent, saveHelpAgent, helpChat } from "../admin/help-agent.controller.js";
import {
  getStaff,
  createStaff,
  updateStaff,
  deleteStaff,
} from "../controllers/admin.controller.js";
import {
  getCompanies,
  getUsers,
  updateCompanyWorkspaces,
  updateUserAccess,
  verifyCompany,
  updateCompanyOnboarding,
  setCompanySuspension,
} from "../admin/superadmin.controller.js";
import {
  getCrmHealth,
  getDefaultNewsSources,
  updateDefaultNewsSources,
  getSupportLeads,
  getSupportAccessLog,
  getSecurityPosture,
  getMessagingSpend,
  setMessagingPricing,
  getSupportContact,
  updateSupportContact,
} from "../admin/platform.controller.js";
import { getSalesAgentAppointments } from "../controllers/admin-sales-agent.controller.js";
import * as b2b from "../admin/b2b.controller.js";
import {
  listSuperStaff,
  inviteSuperStaff,
  updateSuperStaff,
  resendSuperStaffInvite,
  removeSuperStaff,
} from "../admin/super-staff.controller.js";
import { listHandoffIssues, retryHandoffIssue, resolveHandoffIssue } from "../admin/handoffs.controller.js";
import * as coach from "../admin/sales-coach.controller.js";
import { createRateLimiter } from "../middlewares/rate-limit.js";
import {
  getPromptLab,
  savePromptVersion,
  setCurrentPromptVersion,
  deletePromptVersion,
  previewPrompt,
  promptLabChat,
  setPromptVersionLive,
  revertToCodeDefaults,
} from "../admin/prompt-lab.controller.js";
import {
  listKbDocuments,
  uploadKbDocument,
  deleteKbDocument,
  reindexKbDocument,
  probeKb,
  getKbDocumentUrl,
} from "../admin/prompt-lab-kb.controller.js";
import {
  getWarrantyPromptLab,
  saveWarrantyPromptVersion,
  setCurrentWarrantyVersion,
  deleteWarrantyVersion,
  previewWarrantyPrompt,
  warrantyPromptLabChat,
  setWarrantyVersionLive,
  revertWarrantyToDefaults,
} from "../admin/warranty-prompt-lab.controller.js";
import multer from "multer";
import { handleUploadErrors } from "../middlewares/upload.js";

const router = express.Router();

router.get("/messaging/spend", requireAuth, requireAdmin("costs"), getMessagingSpend);
router.patch("/messaging/pricing", requireAuth, requireAdmin("costs"), setMessagingPricing);

router.get("/companies", requireAuth, requireAdmin("companies.view", "support"), getCompanies);
router.get("/users", requireAuth, requireAdmin("companies.view"), getUsers);
router.patch(
  "/companies/:companyId/workspaces",
  requireAuth, requireAdmin("companies.manage"),
  updateCompanyWorkspaces,
);
router.patch("/users/:userId/access", requireAuth, requireAdmin("companies.manage"), updateUserAccess);
router.patch("/companies/:companyId/verify", requireAuth, requireAdmin("companies.manage"), verifyCompany);
router.patch("/companies/:companyId/onboarding", requireAuth, requireAdmin("companies.manage"), updateCompanyOnboarding);
router.patch("/companies/:companyId/suspension", requireAuth, requireAdmin("companies.manage"), setCompanySuspension);
router.get("/crm-health", requireAuth, requireAdmin("integrations"), getCrmHealth);
router.get("/news-defaults", requireAuth, requireAdmin("integrations"), getDefaultNewsSources);
router.put("/news-defaults", requireAuth, requireAdmin("integrations"), updateDefaultNewsSources);
router.get("/support/leads/:companyId", requireAuth, requireAdmin("support"), getSupportLeads);
router.get("/support/access-log", requireAuth, requireAdmin("support"), getSupportAccessLog);
router.get("/handoff-issues", requireAuth, requireAdmin("handoffs"), listHandoffIssues);
router.post("/handoff-issues/:id/retry", requireAuth, requireAdmin("handoffs"), retryHandoffIssue);
router.post("/handoff-issues/:id/resolve", requireAuth, requireAdmin("handoffs"), resolveHandoffIssue);
router.get("/support-contact", requireAuth, getSupportContact);
router.put("/support-contact", requireAuth, requireAdmin("support"), updateSupportContact);
router.get("/help-agent", requireAuth, requireAdmin("prompt-lab"), getHelpAgent);
router.put("/help-agent", requireAuth, requireAdmin("prompt-lab"), saveHelpAgent);
router.post("/help-agent/chat", requireAuth, helpChat);
router.get("/security-posture", requireAuth, requireAdmin("integrations"), getSecurityPosture);
router.get("/staff", requireAuth, getStaff);
router.post("/staff", requireAuth, createStaff);
router.put("/staff", requireAuth, updateStaff);
router.delete("/staff", requireAuth, deleteStaff);
// Super Staff (AI4HB team): Super Admin only, enforced in the controller.
router.get("/super-staff", requireAuth, listSuperStaff);
router.post("/super-staff", requireAuth, inviteSuperStaff);
router.patch("/super-staff/:id", requireAuth, updateSuperStaff);
router.post("/super-staff/:id/invite", requireAuth, resendSuperStaffInvite);
router.delete("/super-staff/:id", requireAuth, removeSuperStaff);
router.get("/sales-agent-appointments", requireAuth, requireAdmin("appointments"), getSalesAgentAppointments);
router.patch("/sales-agent-appointments/:id/status", requireAuth, requireAdmin("appointments"), b2b.updateAppointmentStatus);

// B2B prospecting: business leads, campaigns, platform availability.
router.get("/b2b/leads", requireAuth, requireAdmin("b2b"), b2b.listLeads);
router.post("/b2b/leads", requireAuth, requireAdmin("b2b"), b2b.createLead);
router.post("/b2b/leads/import", requireAuth, requireAdmin("b2b"), b2b.importLeads);
router.patch("/b2b/leads/:id", requireAuth, requireAdmin("b2b"), b2b.updateLead);
router.delete("/b2b/leads/:id", requireAuth, requireAdmin("b2b"), b2b.deleteLead);
router.get("/b2b/campaigns", requireAuth, requireAdmin("b2b"), b2b.listCampaigns);
router.post("/b2b/campaigns", requireAuth, requireAdmin("b2b"), b2b.createCampaign);
router.post("/b2b/campaigns/generate-step", requireAuth, requireAdmin("b2b"), b2b.generateStep);
router.put("/b2b/campaigns/:id", requireAuth, requireAdmin("b2b"), b2b.updateCampaign);
router.patch("/b2b/campaigns/:id/status", requireAuth, requireAdmin("b2b"), b2b.setCampaignStatus);
router.delete("/b2b/campaigns/:id", requireAuth, requireAdmin("b2b"), b2b.deleteCampaign);
router.get("/b2b/campaigns/:id/enrollments", requireAuth, requireAdmin("b2b"), b2b.listEnrollments);
router.post("/b2b/campaigns/:id/enroll", requireAuth, requireAdmin("b2b"), b2b.enrollLeads);
router.post("/b2b/campaigns/:id/unenroll", requireAuth, requireAdmin("b2b"), b2b.unenrollLeads);
router.get("/b2b/availability", requireAuth, requireAdmin("appointments", "b2b"), b2b.getAvailability);
router.put("/b2b/availability", requireAuth, requireAdmin("appointments", "b2b"), b2b.updateAvailability);
const promptLabUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});
const uploadKbFile = handleUploadErrors(promptLabUpload.single("file"));

router.get("/prompt-lab", requireAuth, requireAdmin("prompt-lab"), getPromptLab);
router.post("/prompt-lab/versions", requireAuth, requireAdmin("prompt-lab"), savePromptVersion);
router.post(
  "/prompt-lab/versions/:versionId/set-current",
  requireAuth, requireAdmin("prompt-lab"),
  setCurrentPromptVersion,
);
router.post(
  "/prompt-lab/versions/:versionId/set-live",
  requireAuth, requireAdmin("prompt-lab"),
  setPromptVersionLive,
);
router.post(
  "/prompt-lab/revert-to-defaults",
  requireAuth, requireAdmin("prompt-lab"),
  revertToCodeDefaults,
);
router.delete(
  "/prompt-lab/versions/:versionId",
  requireAuth, requireAdmin("prompt-lab"),
  deletePromptVersion,
);
router.post("/prompt-lab/preview", requireAuth, requireAdmin("prompt-lab"), previewPrompt);
router.post("/prompt-lab/chat", requireAuth, requireAdmin("prompt-lab"), promptLabChat);
router.get("/prompt-lab/kb", requireAuth, requireAdmin("prompt-lab"), listKbDocuments);
router.post(
  "/prompt-lab/kb/upload",
  requireAuth, requireAdmin("prompt-lab"),
  uploadKbFile,
  uploadKbDocument,
);
router.post("/prompt-lab/kb/probe", requireAuth, requireAdmin("prompt-lab"), probeKb);
router.get("/prompt-lab/kb/:documentId/url", requireAuth, requireAdmin("prompt-lab"), getKbDocumentUrl);
router.post(
  "/prompt-lab/kb/:documentId/reindex",
  requireAuth, requireAdmin("prompt-lab"),
  reindexKbDocument,
);
router.delete("/prompt-lab/kb/:documentId", requireAuth, requireAdmin("prompt-lab"), deleteKbDocument);

// Warranty Prompt Lab
router.get("/warranty-prompt-lab", requireAuth, requireAdmin("prompt-lab"), getWarrantyPromptLab);
router.post("/warranty-prompt-lab/versions", requireAuth, requireAdmin("prompt-lab"), saveWarrantyPromptVersion);
router.post("/warranty-prompt-lab/versions/:versionId/set-current", requireAuth, requireAdmin("prompt-lab"), setCurrentWarrantyVersion);
router.post("/warranty-prompt-lab/versions/:versionId/set-live", requireAuth, requireAdmin("prompt-lab"), setWarrantyVersionLive);
router.post("/warranty-prompt-lab/revert-to-defaults", requireAuth, requireAdmin("prompt-lab"), revertWarrantyToDefaults);
router.delete("/warranty-prompt-lab/versions/:versionId", requireAuth, requireAdmin("prompt-lab"), deleteWarrantyVersion);
router.post("/warranty-prompt-lab/preview", requireAuth, requireAdmin("prompt-lab"), previewWarrantyPrompt);
router.post("/warranty-prompt-lab/chat", requireAuth, requireAdmin("prompt-lab"), warrantyPromptLabChat);

// Sales Coach (Track B)
const coachAccess = [requireAuth, requireAdmin("sales-coach")];
const byUser = (req) => req.user.id;
// NFR-06: 15 role-plays per trainee per day; Ask is capped per hour.
const coachDailyCap = createRateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 15, label: "Sales Coach sessions", keyFn: byUser });
const coachAskCap = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 60, label: "Sales Coach ask", keyFn: byUser });
router.get("/sales-coach/scenarios", ...coachAccess, coach.getScenarios);
router.get("/sales-coach/sessions", ...coachAccess, coach.getSessions);
router.post("/sales-coach/sessions", ...coachAccess, coachDailyCap, coach.startSession);
router.get("/sales-coach/sessions/:id", ...coachAccess, coach.getSessionDetail);
router.post("/sales-coach/sessions/:id/turn", ...coachAccess, coach.sendTurn);
router.post("/sales-coach/sessions/:id/hint", ...coachAccess, coach.getHint);
router.post("/sales-coach/sessions/:id/score", ...coachAccess, coach.scoreSession);
router.get("/sales-coach/team", ...coachAccess, coach.getTeam);
router.post("/sales-coach/ask", ...coachAccess, coachAskCap, coach.askCoach);

export default router;
