import { kafka, KAFKA_TOPICS } from "@repo/kafka";
import { KAFKA_CONSUMER_GRP } from "@repo/kafka/src/config.js";

const consumer = kafka.consumer({
  groupId: KAFKA_CONSUMER_GRP.MATCHING_ENGINE_RESPONSE,
});

consumer.connect();

await consumer.subscribe({
  topics: [KAFKA_TOPICS.MATCHING_ENGINE_RESPONSE],
});

export { consumer };
