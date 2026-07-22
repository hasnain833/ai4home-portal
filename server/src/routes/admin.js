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
} from "../admin/platform.controller.js";

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

router.get("/staff", requireAuth, getStaff);
router.post("/staff", requireAuth, createStaff);
router.put("/staff", requireAuth, updateStaff);
router.delete("/staff", requireAuth, deleteStaff);

export default router;
