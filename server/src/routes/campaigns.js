import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getCampaigns,
  getCampaignDetail,
  createCampaign,
  updateCampaign,
  updateCampaignSteps,
  enrollCampaign,
  unenrollCampaign,
  deleteCampaign,
  generateCampaignCopy
} from "../controllers/campaigns.controller.js";

const router = Router();

router.get("/", requireAuth, getCampaigns);
router.post("/generate-copy", requireAuth, generateCampaignCopy);
router.get("/:id", requireAuth, getCampaignDetail);
router.post("/", requireAuth, createCampaign);
router.put("/:id", requireAuth, updateCampaign);
router.post("/:id/steps", requireAuth, updateCampaignSteps);
router.post("/:id/enroll", requireAuth, enrollCampaign);
router.post("/:id/unenroll", requireAuth, unenrollCampaign);
router.delete("/:id", requireAuth, deleteCampaign);

export default router;
