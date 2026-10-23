import { kafka } from "./client.js";
import { TOPIC_LIST } from "./config.js";

export const createTopics = async (): Promise<void> => {
  const admin = kafka.admin();

  await admin.connect();

  await admin.createTopics({
    waitForLeaders: true,
    topics: TOPIC_LIST,
  });

  await admin.disconnect();
};
