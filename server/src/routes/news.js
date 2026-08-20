import express from "express";
import { getNews, refreshNews } from "../controllers/news.controller.js";
import { requireAuth, requireRoles } from "../middlewares/auth.js";

const router = express.Router();

router.use(requireAuth);

// SRS 4.12: a homeowner may view the news feed. Triggering a scrape is a
// builder action — it costs an AI call and writes to the tenant feed.
const builderOnly = requireRoles(["ADMIN", "STAFF"]);

router.get("/", getNews);
router.post("/refresh", builderOnly, refreshNews);

export default router;
