import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getCompanies,
  getStaff,
  createStaff,
  updateStaff,
  deleteStaff
} from "../controllers/admin.controller.js";

const router = express.Router();

router.get("/companies", requireAuth, getCompanies);
router.get("/staff", requireAuth, getStaff);
router.post("/staff", requireAuth, createStaff);
router.put("/staff", requireAuth, updateStaff);
router.delete("/staff", requireAuth, deleteStaff);

export default router;
