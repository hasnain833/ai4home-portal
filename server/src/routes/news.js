import express from "express";
import { getNews, refreshNews } from "../controllers/news.controller.js";
import { requireAuth } from "../middlewares/auth.js";

const router = express.Router();

router.use(requireAuth);

router.get("/", getNews);
router.post("/refresh", refreshNews);

export default router;
