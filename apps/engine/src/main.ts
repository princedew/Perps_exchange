import { kafka, KAFKA_MSG_TYPE, KAFKA_TOPICS, sendToKafka } from "@repo/kafka";
import { KAFKA_CONSUMER_GRP } from "@repo/kafka/src/config.js";
import { orderSchema } from "@repo/utils";
import { Accounts } from "./account.js";
import { PerpsFutureOrderBook } from "./perpsOrderBook.js";

const orderBook = new Map<string, PerpsFutureOrderBook>();

export const consumer = kafka.consumer({
  groupId: KAFKA_CONSUMER_GRP.MATCHING_ENGINE_CONSUMER_GRP,
});

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

      try {
        payload = JSON.parse(message.value.toString());
      } catch (error: unknown) {
        console.error("Invalid Kafka JSON:", error);
        return;
      }

      const { type, input } = payload; // input:{reqIdOfReqHold, market, order};

      if (typeof input !== "object") {
        return;
      }

      if (!input.market || typeof input.market !== "string") {
        console.error("Invalid market:", input.market);
        return;
      }

      let obObj = orderBook.get(input.market);

      if (!obObj) {
        obObj = new PerpsFutureOrderBook(input.market, accounts);
        orderBook.set(input.market, obObj);
      }

      switch (type) {
        case "CREATE_ORDER": {
          const result = orderSchema.safeParse(input);

          if (!result.success) {
            console.error("Invalid create order:", result.error.issues);
            return;
          }

          const fillResult = obObj.fillOrder(result.data);

          await sendToKafka(
            KAFKA_TOPICS.MATCHING_ENGINE_RESPONSE,
            KAFKA_MSG_TYPE.CREATE_RESPONSE,
            1,
            1,
            message.key, // req id key for the req hold in server.
            { fillResult },
          );
          console.log("Order created:", fillResult);
          break;
        }

        case "CLOSE_ORDER": {
          const result = orderSchema.safeParse(input);

          if (!result.success) {
            console.error("Invalid close order:", result.error.issues);
            return;
          }

          const fillResult = obObj.fillOrder(result.data);

          await sendToKafka(
            KAFKA_TOPICS.MATCHING_ENGINE_RESPONSE,
            KAFKA_MSG_TYPE.CLOSE_RESPONSE,
            1,
            1,
            message.key,
            { fillResult },
          );
          console.log("Position close processed:", fillResult);
          break;
        }

        // we have to create a upppdateOrder method.
        // case "MODIFY_ORDER": {
        //   const result = orderSchema.safeParse(input);

        //   if (!result.success) {
        //     console.error("Invalid modify order:", result.error.issues);
        //     return;
        //   }

        //   const order = result.data;

        //   const cancelled = obObj.cancelOrder(order.accId, order.orderId);

        //   if (!cancelled) {
        //     console.error("Order not found for modification:", order.orderId);
        //     return;
        //   }

        //   const fillResult = obObj.fillOrder(order);

        //   await sendToKafka(
        //     KAFKA_TOPICS.MATCHING_ENGINE_RESPONSE,
        //     KAFKA_MSG_TYPE.MODIFY_RESPONSE,
        //     1,
        //     1,
        //     message.key,
        //     { fillResult },
        //   );
        //   console.log("Order modified:", fillResult);
        //   break;
        // }

        case "CANCLE_ORDER": {
          const result = orderSchema.safeParse(input);

          if (!result.success) {
            console.error("Invalid cancel order:", result.error.issues);
            return;
          }

          const order = result.data;

          const cancelled = obObj.cancelOrder(order.accId, order.orderId);

          if (!cancelled) {
            console.error("Order not found:", order.orderId);
            return;
          }
          await sendToKafka(
            KAFKA_TOPICS.MATCHING_ENGINE_RESPONSE,
            KAFKA_MSG_TYPE.MODIFY_RESPONSE,
            1,
            1,
            message.key,
            { orderId: order.orderId },
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
