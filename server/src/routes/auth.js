import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getMe,
  updateProfile,
  requestEmailChange,
  confirmEmailChange,
  cancelEmailChange,
  signup,
  forgotPassword,
  superadminLogin,
  logout,
} from "../controllers/auth.controller.js";

const router = Router();

router.get("/me", requireAuth, getMe);
router.patch("/profile", requireAuth, updateProfile);
router.post("/email-change", requireAuth, requestEmailChange);
router.post("/email-change/cancel", requireAuth, cancelEmailChange);
// Opened from a link in an email, so this one cannot require a session.
router.get("/email-change/confirm", confirmEmailChange);
router.post("/signup", signup);
router.post("/forgot-password", forgotPassword);
router.post("/superadmin-login", superadminLogin);
router.post("/logout", logout);

export default router;
