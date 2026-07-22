import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  searchDataSubjects,
  exportDataSubject,
  eraseDataSubject,
  getPrivacyLog,
} from "../controllers/privacy.controller.js";

const router = Router();

router.get("/subjects", requireAuth, searchDataSubjects);
router.get("/subjects/:type/:id/export", requireAuth, exportDataSubject);
router.post("/subjects/:type/:id/erase", requireAuth, eraseDataSubject);
router.get("/log", requireAuth, getPrivacyLog);

export default router;
