import { Router } from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import {
  getDeadLetters,
  replayDeadLetterEntry,
  discardDeadLetterEntry,
} from "../controllers/dead-letter.controller.js";

const router = Router();

router.get("/", requireAuth, requireRoles(["ADMIN", "STAFF"]), getDeadLetters);
router.post("/:id/replay", requireAuth, requireRoles(["ADMIN"]), replayDeadLetterEntry);
router.post("/:id/discard", requireAuth, requireRoles(["ADMIN"]), discardDeadLetterEntry);

export default router;
