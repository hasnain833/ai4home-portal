import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getSequences,
  getSequenceDetail,
  createSequence,
  updateSequence,
  updateSequenceSteps,
  enrollSequence,
  deleteSequence
} from "../controllers/sequences.controller.js";

const router = Router();

router.get("/", requireAuth, getSequences);
router.get("/:id", requireAuth, getSequenceDetail);
router.post("/", requireAuth, createSequence);
router.put("/:id", requireAuth, updateSequence);
router.post("/:id/steps", requireAuth, updateSequenceSteps);
router.post("/:id/enroll", requireAuth, enrollSequence);
router.delete("/:id", requireAuth, deleteSequence);

export default router;
