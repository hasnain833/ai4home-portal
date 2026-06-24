import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getLeads,
  createLead,
  importLeads,
  deleteLead,
  updateLead,
  getLeadTimeline
} from "../controllers/leads.controller.js";

const router = Router();

router.get("/", requireAuth, getLeads);
router.post("/", requireAuth, createLead);
router.post("/import", requireAuth, importLeads);
router.delete("/:id", requireAuth, deleteLead);
router.patch("/:id", requireAuth, updateLead);
router.get("/:id/timeline", requireAuth, getLeadTimeline);

export default router;
