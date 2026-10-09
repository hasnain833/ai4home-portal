import { Router } from "express";
import { requireAuth, requirePermission } from "../middlewares/auth.js";
import {
  getCampaigns,
  getCampaignDetail,
  createCampaign,
  updateCampaign,
  updateCampaignSteps,
  enrollCampaign,
  unenrollCampaign,
  deleteCampaign,
  generateCampaignCopy,
  createCampaignFromNews
} from "../controllers/campaigns.controller.js";
import {
  getAutoNurture,
  setAutoNurtureActive,
  updateAutoNurtureStep,
} from "../controllers/auto-nurture.controller.js";

const router = Router();

const canManage = requirePermission("campaigns.manage");

router.get("/", requireAuth, getCampaigns);
// The built-in 180-day workflow; registered before "/:id" so "auto" is not an id.
router.get("/auto", requireAuth, getAutoNurture);
router.put("/auto", requireAuth, canManage, setAutoNurtureActive);
router.patch("/auto/steps/:stepId", requireAuth, canManage, updateAutoNurtureStep);
router.get("/:id", requireAuth, getCampaignDetail);

router.post("/generate-copy", requireAuth, canManage, generateCampaignCopy);
router.post("/from-news", requireAuth, canManage, createCampaignFromNews);
router.post("/", requireAuth, canManage, createCampaign);
router.put("/:id", requireAuth, canManage, updateCampaign);
router.post("/:id/steps", requireAuth, canManage, updateCampaignSteps);
router.post("/:id/enroll", requireAuth, canManage, enrollCampaign);
router.post("/:id/unenroll", requireAuth, canManage, unenrollCampaign);
router.delete("/:id", requireAuth, canManage, deleteCampaign);

export default router;
