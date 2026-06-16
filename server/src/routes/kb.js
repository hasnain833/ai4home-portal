import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  getSalesKB,
  addSalesKBDocument,
  deleteSalesKBDocument
} from "../controllers/kb.controller.js";

const router = Router();

router.get("/", requireAuth, getSalesKB);
router.post("/", requireAuth, addSalesKBDocument);
router.delete("/:id", requireAuth, deleteSalesKBDocument);

export default router;
