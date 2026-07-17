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

const router = Router();

// §4.12: nurture sequences are "Per permission" for a Builder Member. Reads stay
// open to anyone with Sales access — the grant gates changing and launching, which
// is what actually reaches a lead.
const canManage = requirePermission("campaigns.manage");

router.get("/", requireAuth, getCampaigns);
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
