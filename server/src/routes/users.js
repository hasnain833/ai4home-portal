import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import { getUsers } from "../controllers/users.controller.js";

const router = express.Router();

router.get("/", requireAuth, getUsers);

export default router;
