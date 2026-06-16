import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getMe,
  updateProfile,
  signup,
  forgotPassword
} from "../controllers/auth.controller.js";

const router = Router();

router.get("/me", requireAuth, getMe);
router.patch("/profile", requireAuth, updateProfile);
router.post("/signup", signup);
router.post("/forgot-password", forgotPassword);

export default router;
