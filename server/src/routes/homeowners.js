import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getHomeowners,
  getHomeowner,
  createHomeowner,
  updateHomeowner,
  deleteHomeowner
} from "../controllers/homeowners.controller.js";

const router = express.Router();

router.get("/", requireAuth, getHomeowners);
router.get("/:id", requireAuth, getHomeowner);
router.post("/", requireAuth, createHomeowner);
router.patch("/:id", requireAuth, updateHomeowner);
router.delete("/", requireAuth, deleteHomeowner);

export default router;
