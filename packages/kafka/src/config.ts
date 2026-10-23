export const KAFKA_TOPICS = {
  MATCHING_ENGINE: "order.engine",
  REALTIME: "message.realtime",
  NOTIFICATION: "message.notification",
};

export const KAFKA_MSG_TYPE = {
  CREATE: "create",
  MODIFY: "modify",
  CLOSE: "close",
};

export const TOPIC_LIST = [
  {
    topic: KAFKA_TOPICS.MATCHING_ENGINE,
    numPartinumPartitions: 3,
    replicationFactor: 1,
  },
  {
    topic: KAFKA_TOPICS.REALTIME,
    numPartinumPartitions: 3,
    replicationFactor: 1,
  },
];
