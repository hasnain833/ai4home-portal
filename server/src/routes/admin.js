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
} from "../admin/superadmin.controller.js";

const router = express.Router();

router.get("/companies", requireAuth, getCompanies);
router.get("/users", requireAuth, getUsers);
router.patch(
  "/companies/:companyId/workspaces",
  requireAuth,
  updateCompanyWorkspaces,
);
router.patch("/users/:userId/access", requireAuth, updateUserAccess);
router.get("/staff", requireAuth, getStaff);
router.post("/staff", requireAuth, createStaff);
router.put("/staff", requireAuth, updateStaff);
router.delete("/staff", requireAuth, deleteStaff);

export default router;
