// realtime/src/main.ts

import {
  kafka,
  KAFKA_MSG_TYPE,
  KAFKA_TOPICS,
} from "@repo/kafka";

import { redis } from "@repo/redis";
import { z } from "zod";

import { startWebSocketServer } from "./websocket.js";
import {
  startRedisSubscriber,
  REALTIME_REDIS_CHANNEL,
} from "./redisSubscriber.js";

import { KAFKA_CONSUMER_GRP } from "@repo/kafka/src/config.js";

// -------------------- KAFKA CONSUMER --------------------

export const consumer = kafka.consumer({
  groupId: KAFKA_CONSUMER_GRP.REALTIME_CONSUMER_GRP,
});

// -------------------- EVENT SCHEMA --------------------

const marketPriceUpdateSchema = z.object({
  market: z.string().min(1),
  currentPrice: z.number().positive(),
});

type MarketPriceUpdate = z.infer<typeof marketPriceUpdateSchema>;

// -------------------- CONSUMER --------------------

async function runConsumer(): Promise<void> {
  await consumer.connect();

  await consumer.subscribe({
    topic: KAFKA_TOPICS.REALTIME,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;

      let payload: unknown;

      try {
        payload = JSON.parse(message.value.toString());
      } catch (error: unknown) {
        console.error("Invalid Kafka JSON:", error);
        return;
      }

      if (
        typeof payload !== "object" ||
        payload === null ||
        !("type" in payload) ||
        !("input" in payload)
      ) {
        console.error("Invalid realtime Kafka payload");
        return;
      }

      const { type, input } = payload;

      if (typeof type !== "string") {
        console.error("Invalid realtime event type:", type);
        return;
      }

      switch (type) {
        case KAFKA_MSG_TYPE.MARKET_PRICE_UPDATE: {
          const result = marketPriceUpdateSchema.safeParse(input);

          if (!result.success) {
            console.error(
              "Invalid market price update:",
              result.error.issues,
            );
            return;
          }

          const event: MarketPriceUpdate = result.data;

          await redis.publish(
            REALTIME_REDIS_CHANNEL,
            JSON.stringify({
              market: event.market,
              data: {
                currentPrice: event.currentPrice,
              },
            }),
          );

          console.log(
            `Market price published: ${event.market} = ${event.currentPrice}`,
          );

          break;
        }

        default:
          console.warn("Unknown realtime event:", type);
      }
    },
  });
}

// -------------------- START --------------------

// Start WebSocket server.
await startWebSocketServer(8000);

// Start Redis subscriber.
await startRedisSubscriber();

// Start Kafka consumer.
await runConsumer().catch((error: unknown) => {
  console.error("Realtime consumer failed:", error);
});