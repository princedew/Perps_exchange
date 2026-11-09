// engine/src/main.ts

// [TASK-1] In these 4 cases, i made a mistake instead of sending it to the Notification service i had send it to the realtime service, your job is to fix it.
// [TASK-2] After the fillOrder the price changes if i m getting this right then u send message to realtime using sendKafka fn in which u are going send example: {market:"BTC", currentPrice:5512124}

import { kafka, KAFKA_MSG_TYPE, KAFKA_TOPICS, sendToKafka } from "@repo/kafka";
import { KAFKA_CONSUMER_GRP } from "@repo/kafka/src/config.js";
import { orderSchema } from "@repo/utils";
import { Accounts } from "./account.js";
import { PerpsFutureOrderBook } from "./perpsOrderBook.js";

const orderBook = new Map<string, PerpsFutureOrderBook>();

export const consumer = kafka.consumer({
  groupId: KAFKA_CONSUMER_GRP.MATCHING_ENGINE_CONSUMER_GRP,
});

async function publishMarketPrice(
  market: string,
  fillResult: ReturnType<PerpsFutureOrderBook["fillOrder"]>,
  key: string,
): Promise<void> {
  // fillOrder must expose the actual execution price.
  // Do not use the incoming order's limitPrice as a substitute.
  const executionPrice =
    "executionPrice" in fillResult &&
    typeof fillResult.executionPrice === "number"
      ? fillResult.executionPrice
      : undefined;

  if (executionPrice === undefined) return;

  await sendToKafka(
    KAFKA_TOPICS.REALTIME as keyof typeof KAFKA_TOPICS,
    KAFKA_MSG_TYPE.MARKET_PRICE_UPDATE as keyof typeof KAFKA_MSG_TYPE,
    1,
    1,
    key,
    {
      market,
      currentPrice: executionPrice,
    },
  );
}

async function runConsumer(): Promise<void> {
  const accounts = createAccounts();

  await consumer.connect();

  await consumer.subscribe({
    topic: KAFKA_TOPICS.MATCHING_ENGINE,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;

      let payload: {
        market: string;
        type: string;
        input: unknown;
      };

      const key = message.key?.toString();

      if (!key || typeof key !== "string") {
        console.log("Invalid string.");
        return;
      }

      try {
        payload = JSON.parse(message.value.toString());
      } catch (error: unknown) {
        console.error("Invalid Kafka JSON:", error);
        return;
      }

      if (typeof payload !== "object" || payload === null) {
        console.error("Invalid Kafka payload");
        return;
      }

      const { type, input } = payload;

      if (typeof type !== "string" || !type) {
        console.error("Invalid Kafka message type:", type);
        return;
      }

      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        console.error("Invalid Kafka input:", input);
        return;
      }

      const { market, order } = input;

      if (typeof market !== "string" || !market.trim()) {
        console.error("Invalid market:", market);
        return;
      }

      if (typeof order !== "object" || order === null || Array.isArray(order)) {
        console.error("Invalid order:", order);
        return;
      }

      let obObj = orderBook.get(market);

      if (!obObj) {
        obObj = new PerpsFutureOrderBook(market, accounts);
        orderBook.set(market, obObj);
      }

      switch (type) {
        // ------------------------
        // CASE 1
        // ------------------------
        case KAFKA_MSG_TYPE.CREATE: {
          const result = orderSchema.safeParse(input.order);

          if (!result.success) {
            console.error("Invalid create order:", result.error.issues);
            return;
          }

          const order = result.data;
          const fillResult = obObj.fillOrder(order);

          await sendToKafka(
            KAFKA_TOPICS.MATCHING_ENGINE_RESPONSE,
            KAFKA_MSG_TYPE.CREATE_RESPONSE,
            1,
            1,
            key,
            { fillResult },
          );

          // Notification service
          await sendToKafka(
            KAFKA_TOPICS.NOTIFICATION,
            KAFKA_MSG_TYPE.NOTIFY_CREATE,
            1,
            1,
            key,
            {
              accId: order.accId,
              market,
              orderId: order.orderId,
              positionId: order.positionId,
              side: order.side,
              direction: order.direction,
              status: fillResult.message,
              success:
                !("success" in fillResult) &&
                fillResult.message !== "SELF_TRADE_PREVENTED",
            },
          );

          // Market price update (only if an execution occurred)
          await publishMarketPrice(market, fillResult, key);

          console.log("Order created:", fillResult);
          break;
        }

        // ------------------------
        // CASE 2
        // ------------------------
        case KAFKA_MSG_TYPE.CLOSE: {
          const result = orderSchema.safeParse(input.order);

          if (!result.success) {
            console.error("Invalid close order:", result.error.issues);
            return;
          }

          const order = result.data;
          const fillResult = obObj.fillOrder(order);

          await sendToKafka(
            KAFKA_TOPICS.MATCHING_ENGINE_RESPONSE,
            KAFKA_MSG_TYPE.CLOSE_RESPONSE,
            1,
            1,
            key,
            { fillResult },
          );

          // Notification service
          await sendToKafka(
            KAFKA_TOPICS.NOTIFICATION,
            KAFKA_MSG_TYPE.NOTIFY_CLOSE,
            1,
            1,
            key,
            {
              accId: order.accId,
              market,
              orderId: order.orderId,
              positionId: order.positionId,
              side: order.side,
              direction: order.direction,
              status: fillResult.message,
              success:
                !("success" in fillResult) &&
                fillResult.message !== "SELF_TRADE_PREVENTED",
            },
          );

          // Market price update (only if an execution occurred)
          await publishMarketPrice(market, fillResult, key);

          console.log("Position close processed:", fillResult);
          break;
        }

        // ------------------------
        // CASE 3
        // ------------------------
        case KAFKA_MSG_TYPE.MODIFY: {
          const result = orderSchema.safeParse(input.order);

          if (!result.success) {
            console.error("Invalid modify order:", result.error.issues);
            return;
          }

          const order = result.data;

          const modified = obObj.modifyOrderInTreeAndAccount(
            order.accId,
            order.positionId,
            order.takeProfit,
            order.stopLoss,
          );

          await sendToKafka(
            KAFKA_TOPICS.MATCHING_ENGINE_RESPONSE,
            KAFKA_MSG_TYPE.MODIFY_RESPONSE,
            1,
            1,
            key,
            {
              success: modified,
              message: modified ? "ORDER_MODIFIED" : "ORDER_NOT_FOUND",
              positionId: order.positionId,
            },
          );

          // Notification service
          await sendToKafka(
            KAFKA_TOPICS.NOTIFICATION,
            KAFKA_MSG_TYPE.NOTIFY_MODIFY,
            1,
            1,
            key,
            {
              accId: order.accId,
              market,
              positionId: order.positionId,
              takeProfit: order.takeProfit,
              stopLoss: order.stopLoss,
              success: modified,
              message: modified ? "ORDER_MODIFIED" : "ORDER_NOT_FOUND",
            },
          );

          console.log("Order modified:", order.positionId);
          break;
        }

        // ------------------------
        // CASE 4
        // ------------------------
        case KAFKA_MSG_TYPE.CANCEL: {
          const result = orderSchema.safeParse(input.order);

          if (!result.success) {
            console.error("Invalid cancel order:", result.error.issues);
            return;
          }

          const order = result.data;

          const cancelled = obObj.cancelUnFilledOrderFromTree(
            order.accId,
            order.orderId,
            order.positionId,
          );

          await sendToKafka(
            KAFKA_TOPICS.MATCHING_ENGINE_RESPONSE,
            KAFKA_MSG_TYPE.CANCEL_RESPONSE,
            1,
            1,
            key,
            {
              orderId: order.orderId,
              success: cancelled.success,
              message: cancelled.message,
            },
          );

          // Notification service
          await sendToKafka(
            KAFKA_TOPICS.NOTIFICATION,
            KAFKA_MSG_TYPE.NOTIFY_CANCEL,
            1,
            1,
            key,
            {
              accId: order.accId,
              market,
              orderId: order.orderId,
              positionId: order.positionId,
              success: cancelled.success,
              message: cancelled.message,
            },
          );

          console.log("Order cancelled:", order.orderId);
          break;
        }

        default:
          console.warn("Unsupported Kafka message type:", type);
      }
    },
  });
}

await runConsumer().catch(console.error);

function createAccounts(): Accounts {
  return new Accounts();
}
