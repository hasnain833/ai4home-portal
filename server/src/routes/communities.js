import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getCommunities,
  createCommunity,
  deleteCommunity
} from "../controllers/communities.controller.js";

const router = express.Router();

router.get("/", requireAuth, getCommunities);
router.post("/", requireAuth, createCommunity);
router.delete("/", requireAuth, deleteCommunity);

export default router;
