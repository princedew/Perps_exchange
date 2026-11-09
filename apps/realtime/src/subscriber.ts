import { redis } from "@repo/redis";
import { z } from "zod";
import { sendMarketUpdate } from "./websocket.js";

// -------------------- CONFIGURATION --------------------

export const REALTIME_REDIS_CHANNEL = "market:updates";

// Create a separate Redis connection for subscribing.
const subscriber = redis.duplicate();

// -------------------- SCHEMAS --------------------

const marketUpdateSchema = z.object({
  market: z.string().min(1),
  data: z.object({
    currentPrice: z.number().positive(),
  }),
});

// -------------------- REDIS SUBSCRIBER --------------------

export async function startRedisSubscriber(): Promise<void> {
  subscriber.on("error", (error: Error) => {
    console.error("Redis subscriber error:", error);
  });

  // Listen for messages from Redis.
  subscriber.on("message", (channel: string, message: string) => {
    if (channel !== REALTIME_REDIS_CHANNEL) return;

    let payload: unknown;

    try {
      payload = JSON.parse(message);
    } catch (error: unknown) {
      console.error("Invalid Redis JSON:", error);
      return;
    }

    const result = marketUpdateSchema.safeParse(payload);

    if (!result.success) {
      console.error("Invalid Redis market update:", result.error.issues);
      return;
    }

    const event = result.data;

    // Forward the update to locally connected WebSocket clients.
    sendMarketUpdate(event.market, event.data);

    console.log(
      `Redis market update received: ${event.market} = ${event.data.currentPrice}`,
    );
  });

  await subscriber.subscribe(REALTIME_REDIS_CHANNEL);

  console.log(`Redis subscriber listening on ${REALTIME_REDIS_CHANNEL}`);
}
