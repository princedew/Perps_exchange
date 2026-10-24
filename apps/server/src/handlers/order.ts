import { pool } from "@repo/db";
import { KAFKA_MSG_TYPE, KAFKA_TOPICS, sendToKafka } from "@repo/kafka";
import { redis } from "@repo/redis";
import type { Request, Response } from "express";
import { consumer } from "../consumer.js";

type FilledQuantityResult = {
  success: boolean;
  filledQty: number;
};

export async function createOrderHandler(req: Request, res: Response) {
  const userId = req.userId;
  const {
    accId,
    marketId,
    type,
    side,
    quantity,
    leverage,
    limitPrice,
    takeProfit,
    stopLoss,
  } = req.body;

  const reqId = crypto.randomUUID();

  const getFilledQuantity = new Promise(async (resolve) => {
    await redis.set(reqId, JSON.stringify({ resolve }));
  });

  sendToKafka(
    KAFKA_TOPICS.MATCHING_ENGINE as keyof typeof KAFKA_TOPICS,
    1,
    KAFKA_MSG_TYPE.CREATE as keyof typeof KAFKA_MSG_TYPE,
    {
      reqId,
      accId,
      marketId,
      type,
      side,
      quantity,
      leverage,
      limitPrice,
      takeProfit,
      stopLoss,
    },
  );

  const filledQty = await getFilledQuantity;

  if (typeof filledQty !== "number") {
    throw new AppError("", 409);
  }

  // save into db, schema is in perps/packages/db/migrates/001_schema.sql

  res.status(201).json({
    success: true,
    message: "Order created successfully",
    data: { filledQty: filledQty },
  });
}

export async function revokeHold() {
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;

      const result = JSON.parse(message.value.toString());
      const resolverObject = await redis.get(result.reqId);

      if (resolverObject) {
        redis.del(result.reqId);
        const parsedResolver = JSON.parse(resolverObject);
        const reqResolver = parsedResolver.resolve;
        reqResolver(Number(result.filledQty));
      }
    },
  });
}

export async function updateOrderHandler(req: Request, res: Response) {}
export async function closeOrderHandler(req: Request, res: Response) {}
