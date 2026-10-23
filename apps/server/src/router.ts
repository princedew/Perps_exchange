import { Router } from "express";
import {
  createOrderHandler,
  updateOrderHandler,
  closeOrderHandler,
} from "./handlers/order.js";
import {
  getPositionsHandler,
  getTransactionsHandler,
  getHoldingsHandler,
} from "./handlers/getHandlers.js";
import { auth, createOrderSchema, validate } from "@repo/utils";

const router = Router();

router.post("/orders", validate(createOrderSchema), createOrderHandler);
router.patch("/orders/:orderId", updateOrderHandler);
router.post("/close/orders/:orderId", closeOrderHandler);

router.get("/positions/:accId", getPositionsHandler);
router.get("/transactions/:accId", getTransactionsHandler);
router.get("/holdings/:accId", getHoldingsHandler);

export default router;
