import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getLeads,
  getLead,
  createLead,
  importLeads,
  deleteLead,
  updateLead
} from "../controllers/leads.controller.js";

const router = Router();

router.get("/", requireAuth, getLeads);
router.post("/", requireAuth, createLead);
router.post("/import", requireAuth, importLeads);
router.get("/:id", requireAuth, getLead);
router.delete("/:id", requireAuth, deleteLead);
router.patch("/:id", requireAuth, updateLead);

export default router;
