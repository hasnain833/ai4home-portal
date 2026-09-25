import express from "express";
import { createRateLimiter } from "../middlewares/rate-limit.js";
import { getLeadForm, submitLeadForm } from "../controllers/lead-form.controller.js";

const router = express.Router();

const submitLimiter = createRateLimiter({ windowMs: 60_000, max: 5, label: "Lead form" });

router.get("/:companyId", getLeadForm);
router.post("/:companyId", submitLimiter, submitLeadForm);

export default router;
