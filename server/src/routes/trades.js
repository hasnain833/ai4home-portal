import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  listTrades,
  createTrade,
  updateTrade,
  removeTrade,
  resendTradeInvite,
  myJobs,
  myJob,
  markWorkDone,
  getCalendly,
  startCalendlyConnect,
  calendlyCallback,
  removeCalendly,
  getCalendlyEventTypes,
  putCalendlyEventType,
} from "../controllers/trades.controller.js";

/** Builder side, mounted behind the warranty guard at /api/trades. */
export const tradesRouter = express.Router();
tradesRouter.get("/", listTrades);
tradesRouter.post("/", createTrade);
tradesRouter.patch("/:id", updateTrade);
tradesRouter.delete("/:id", removeTrade);
tradesRouter.post("/:id/invite", resendTradeInvite);

/** Trade side, at /api/trade: the only API a TRADE login can reach. */
export const tradePortalRouter = express.Router();
tradePortalRouter.get("/jobs", requireAuth, myJobs);
tradePortalRouter.get("/jobs/:id", requireAuth, myJob);
tradePortalRouter.post("/jobs/:id/done", requireAuth, markWorkDone);
tradePortalRouter.get("/calendly", requireAuth, getCalendly);
tradePortalRouter.post("/calendly/connect", requireAuth, startCalendlyConnect);
tradePortalRouter.get("/calendly/callback", calendlyCallback);
tradePortalRouter.delete("/calendly", requireAuth, removeCalendly);
tradePortalRouter.get("/calendly/event-types", requireAuth, getCalendlyEventTypes);
tradePortalRouter.put("/calendly/event-type", requireAuth, putCalendlyEventType);
