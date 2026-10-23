import { producer } from "./client.js";
import { KAFKA_MSG_TYPE, type KAFKA_TOPICS } from "./config.js";

await producer.connect();

export async function sendToKafka(
  topic: keyof typeof KAFKA_TOPICS,
  acks: 0 | 1 | -1,
  input: any,
): Promise<void> {
  await producer.send({
    topic,
    acks,
    messages: [
      {
        key: String(input.marketId),
        value: JSON.stringify({ type: KAFKA_MSG_TYPE.CREATE, input }),
      },
    ],
  });
}
