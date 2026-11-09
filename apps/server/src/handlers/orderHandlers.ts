import { pool } from "@repo/db";
import { KAFKA_MSG_TYPE, KAFKA_TOPICS, sendToKafka } from "@repo/kafka";
import { redis } from "@repo/redis";
import type { Request, Response } from "express";
import { consumer } from "../consumer.js";
import {
  createPendingRequest,
  rejectPendingRequest,
} from "../utils/pendingRequest.js";

export async function createOrderHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const {
    accId,
    marketId,
    type,
    side,
    direction,
    quantity,
    leverage,
    limitPrice,
    takeProfit,
    stopLoss,
  } = req.body;

  const reqId = crypto.randomUUID();

  // 1. Register the pending request first.
  const filledQuantityPromise = createPendingRequest(reqId, Number(quantity));

  try {
    // 2. Send order to Matching Engine.
    await sendToKafka(
      KAFKA_TOPICS.MATCHING_ENGINE as keyof typeof KAFKA_TOPICS,
      KAFKA_MSG_TYPE.CREATE as keyof typeof KAFKA_MSG_TYPE,
      1,
      1,
      reqId,
      {
        accId,
        marketId,
        type,
        side,
        direction,
        quantity,
        leverage,
        limitPrice,
        takeProfit,
        stopLoss,
      },
    );
  } catch (error: unknown) {
    rejectPendingRequest(
      reqId,
      error instanceof Error ? error : new Error("Kafka publishing failed"),
    );

    throw error;
  }

  const filledQty = await filledQuantityPromise;

  // db atomic transaction
  // add transaction
  // add order
  // add position
  // add trade

  res.status(201).json({
    success: true,
    message: "Order completely filled",
    data: {
      reqId,
      filledQty,
    },
  });
}

export async function updateOrderHandler(req: Request, res: Response) {}
export async function closeOrderHandler(req: Request, res: Response) {}
export async function cancelOrderHandler(req: Request, res: Response) {}
