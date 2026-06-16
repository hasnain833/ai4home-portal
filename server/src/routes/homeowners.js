import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getHomeowners,
  createHomeowner,
  deleteHomeowner
} from "../controllers/homeowners.controller.js";

const router = express.Router();

router.get("/", requireAuth, getHomeowners);
router.post("/", requireAuth, createHomeowner);
router.delete("/", requireAuth, deleteHomeowner);

export default router;
