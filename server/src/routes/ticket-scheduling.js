import express from "express";
import {
  publicGetBooking,
  publicBook,
  publicGetManage,
  publicReschedule,
  publicCancel,
} from "../controllers/ticket-scheduling.controller.js";

// Every route here is reached from an email link with no session — the token in
// the URL is the authorisation. Nothing in this file may take requireAuth.
const router = express.Router();

router.get("/public/:token", publicGetBooking);
router.post("/public/book", publicBook);
router.get("/public/manage/:token", publicGetManage);
router.post("/public/reschedule", publicReschedule);
router.post("/public/cancel", publicCancel);

export default router;
