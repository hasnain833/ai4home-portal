import express from "express";
import { createRateLimiter } from "../middlewares/rate-limit.js";
import { getSuggestions, postMessage, bookVisit } from "../controllers/sales-chat.controller.js";

const router = express.Router();

// Every turn is a paid model call.
const chatLimiter = createRateLimiter({ windowMs: 60_000, max: 20, label: "Sales chat" });
const bookLimiter = createRateLimiter({ windowMs: 60_000, max: 5, label: "Sales chat booking" });

router.get("/suggestions", getSuggestions);
router.post("/", chatLimiter, postMessage);
router.post("/book", bookLimiter, bookVisit);

export default router;
