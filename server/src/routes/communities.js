import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getCommunities,
  createCommunity,
  updateCommunity,
  deleteCommunity
} from "../controllers/communities.controller.js";

const router = express.Router();

router.get("/", requireAuth, getCommunities);
router.post("/", requireAuth, createCommunity);
router.patch("/:id", requireAuth, updateCommunity);
router.delete("/:id", requireAuth, deleteCommunity);
// The knowledge-base page still deletes with ?id=, so that form stays supported.
router.delete("/", requireAuth, deleteCommunity);

export default router;
