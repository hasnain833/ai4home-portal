import express from "express";
import { requireAuth } from "../middlewares/auth.js";
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
} from "../admin/superadmin.controller.js";
import {
  getCrmHealth,
  getDefaultNewsSources,
  updateDefaultNewsSources,
  getSupportLeads,
  getSupportAccessLog,
  getSecurityPosture,
  getAiKeySettings,
  updatePlatformAiKey,
  updateCompanyAiGrant,
} from "../admin/platform.controller.js";
import { getSalesAgentAppointments } from "../controllers/admin-sales-agent.controller.js";
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
} from "../admin/prompt-lab-kb.controller.js";
import multer from "multer";
import { handleUploadErrors } from "../middlewares/upload.js";

const router = express.Router();

router.get("/companies", requireAuth, getCompanies);
router.get("/users", requireAuth, getUsers);
router.patch(
  "/companies/:companyId/workspaces",
  requireAuth,
  updateCompanyWorkspaces,
);
router.patch("/users/:userId/access", requireAuth, updateUserAccess);
router.patch("/companies/:companyId/verify", requireAuth, verifyCompany);
router.get("/crm-health", requireAuth, getCrmHealth);
router.get("/news-defaults", requireAuth, getDefaultNewsSources);
router.put("/news-defaults", requireAuth, updateDefaultNewsSources);
router.get("/support/leads/:companyId", requireAuth, getSupportLeads);
router.get("/support/access-log", requireAuth, getSupportAccessLog);
router.get("/security-posture", requireAuth, getSecurityPosture);

router.get("/ai-keys", requireAuth, getAiKeySettings);
router.put("/ai-keys/platform", requireAuth, updatePlatformAiKey);
router.patch("/ai-keys/companies/:companyId", requireAuth, updateCompanyAiGrant);

router.get("/staff", requireAuth, getStaff);
router.post("/staff", requireAuth, createStaff);
router.put("/staff", requireAuth, updateStaff);
router.delete("/staff", requireAuth, deleteStaff);

router.get("/sales-agent-appointments", requireAuth, getSalesAgentAppointments);

// Prompt lab (super admin only — enforced inside each handler).
const promptLabUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});
const uploadKbFile = handleUploadErrors(promptLabUpload.single("file"));

router.get("/prompt-lab", requireAuth, getPromptLab);
router.post("/prompt-lab/versions", requireAuth, savePromptVersion);
// "set-current" only picks which draft the lab reopens. It publishes nothing.
router.post("/prompt-lab/versions/:versionId/set-current", requireAuth, setCurrentPromptVersion);
// "set-live" DOES publish: it puts this version in front of real leads.
// Guards live in the handler — validation must pass, warnings must be acknowledged.
router.post("/prompt-lab/versions/:versionId/set-live", requireAuth, setPromptVersionLive);
router.post("/prompt-lab/revert-to-defaults", requireAuth, revertToCodeDefaults);
router.delete("/prompt-lab/versions/:versionId", requireAuth, deletePromptVersion);
router.post("/prompt-lab/preview", requireAuth, previewPrompt);
router.post("/prompt-lab/chat", requireAuth, promptLabChat);

// Knowledge base, managed from the lab. Defaults to the PLATFORM tier.
router.get("/prompt-lab/kb", requireAuth, listKbDocuments);
router.post("/prompt-lab/kb/upload", requireAuth, uploadKbFile, uploadKbDocument);
router.post("/prompt-lab/kb/probe", requireAuth, probeKb);
router.post("/prompt-lab/kb/:documentId/reindex", requireAuth, reindexKbDocument);
router.delete("/prompt-lab/kb/:documentId", requireAuth, deleteKbDocument);

export default router;
