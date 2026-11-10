import express from "express";
import { getNews } from "../controllers/news.controller.js";
import { requireAuth } from "../middlewares/auth.js";

const router = express.Router();

router.use(requireAuth);

// SRS 4.12: builders and homeowners read the feed; only the Super Admin publishes to it.
router.get("/", getNews);

export default router;
