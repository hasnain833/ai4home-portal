import express from "express";
import { getNews } from "../controllers/news.controller.js";
import { requireAuth } from "../middlewares/auth.js";

const router = express.Router();

router.use(requireAuth);

router.get("/", getNews);

export default router;
