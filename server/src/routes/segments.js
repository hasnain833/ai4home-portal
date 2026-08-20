import { Router } from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import {
  getSegments,
  createSegment,
  deleteSegment,
  evaluateSegment
} from "../controllers/segments.controller.js";

const router = Router();

// Segments are tenant-wide audiences, and their evaluated counts reveal how
// many leads the whole company holds. A homeowner only ever sees their own
// leads, so segments are builder-only.
const builderOnly = requireRoles(["ADMIN", "STAFF"]);

router.get("/", requireAuth, builderOnly, getSegments);
router.post("/", requireAuth, builderOnly, createSegment);
router.delete("/:id", requireAuth, builderOnly, deleteSegment);
router.get("/:id/evaluate", requireAuth, builderOnly, evaluateSegment);

export default router;
