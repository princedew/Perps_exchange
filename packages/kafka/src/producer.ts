import { pool } from "../../db/src/db.js";
import { producer } from "./client.js";
import { KAFKA_MSG_TYPE, type KAFKA_TOPICS } from "./config.js";

export const marketMap = new Map<string, number>() // "BTC_USDT: 12" // 12 is market id in db.

export function fetchMarketTurnIntoMap() {
  
}

export async function sendToKafka(
  topic: keyof typeof KAFKA_TOPICS,
  type: keyof typeof KAFKA_MSG_TYPE,
  partition: number,
  acks: 0 | 1 | -1,
  key:string,
  input: Record<string, any>,
): Promise<void> {
  await producer.connect();
  await producer.send({
    topic,
    acks,
    messages: [
      {
        partition,
        key,
        value: JSON.stringify({ type, input }),
      },
    ],
  });
  await producer.disconnect();
}
