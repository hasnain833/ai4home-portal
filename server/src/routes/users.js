import express from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { getUsers } from "../controllers/users.controller.js";

const router = express.Router();

router.get("/", requireAuth, requireRoles(["ADMIN", "STAFF"]), getUsers);

export default router;
