import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getProperties,
  createProperty,
  updateProperty,
  deleteProperty
} from "../controllers/properties.controller.js";

const router = express.Router();

router.get("/", requireAuth, getProperties);
router.post("/", requireAuth, createProperty);
router.patch("/:id", requireAuth, updateProperty);
router.delete("/:id", requireAuth, deleteProperty);

export default router;
