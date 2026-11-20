import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { createRateLimiter } from "../middlewares/rate-limit.js";
import {
  getMe,
  updateProfile,
  requestEmailChange,
  confirmEmailChange,
  cancelEmailChange,
  signup,
  forgotPassword,
  superadminLogin,
  superadminVerifyCode,
  logout,
} from "../controllers/auth.controller.js";

const WINDOW_15_MIN = 15 * 60_000;
const byEmail = (req) => `email:${String(req.body?.email || "").trim().toLowerCase()}`;

// Every sign-in posts here first, and the login page carries on to Supabase on a
// 429, so these limits slow password guessing without blocking ordinary users.
const superadminLoginLimits = [
  createRateLimiter({ max: 30, windowMs: WINDOW_15_MIN, failClosed: true, label: "Super Admin login" }),
  createRateLimiter({ max: 10, windowMs: WINDOW_15_MIN, failClosed: true, label: "Super Admin login", keyFn: byEmail }),
];
const superadminCodeLimits = [
  createRateLimiter({ max: 20, windowMs: WINDOW_15_MIN, failClosed: true, label: "Super Admin code" }),
  // Per challenge (its signature), so a code can't be guessed one try at a time.
  createRateLimiter({
    max: 5,
    windowMs: WINDOW_15_MIN,
    failClosed: true,
    label: "Super Admin code",
    keyFn: (req) => `challenge:${String(req.body?.challenge || "").slice(-43)}`,
  }),
];
const signupLimit = createRateLimiter({ max: 5, windowMs: 60 * 60_000, label: "Signup" });
const forgotPasswordLimits = [
  createRateLimiter({ max: 10, windowMs: WINDOW_15_MIN, label: "Forgot password" }),
  createRateLimiter({ max: 3, windowMs: WINDOW_15_MIN, label: "Forgot password", keyFn: byEmail }),
];

// Each request emails an address the caller chooses; cap it so it can't be used to spam.
const emailChangeLimit = createRateLimiter({
  max: 5,
  windowMs: 60 * 60_000,
  label: "Email change",
  keyFn: (req) => `email-change:${req.user?.id}`,
});

const router = Router();

router.get("/me", requireAuth, getMe);
router.patch("/profile", requireAuth, updateProfile);
router.post("/email-change", requireAuth, emailChangeLimit, requestEmailChange);
router.post("/email-change/cancel", requireAuth, cancelEmailChange);
// Opened from a link in an email, so this one cannot require a session.
router.get("/email-change/confirm", confirmEmailChange);
router.post("/signup", signupLimit, signup);
router.post("/forgot-password", ...forgotPasswordLimits, forgotPassword);
router.post("/superadmin-login", ...superadminLoginLimits, superadminLogin);
router.post("/superadmin-verify", ...superadminCodeLimits, superadminVerifyCode);
router.post("/logout", logout);

export default router;
