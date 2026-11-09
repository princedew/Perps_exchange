export const KAFKA_CONSUMER_GRP = {
  MATCHING_ENGINE_CONSUMER_GRP: "order.engine.consumer",
  REALTIME_CONSUMER_GRP: "updates.realtime.consumer",
};

export const KAFKA_TOPICS = {
  MATCHING_ENGINE: "order.engine",
  MATCHING_ENGINE_RESPONSE: "order.engine.res",
  REALTIME: "message.realtime",
  NOTIFICATION: "message.notification",
};

export const KAFKA_MSG_TYPE = {
  CREATE: "create",
  MODIFY: "modify",
  CLOSE: "close",
  CANCEL: "cancel",

  // ENGINE -> BACKEND
  CREATE_RESPONSE: "create.res",
  MODIFY_RESPONSE: "modify.res",
  CLOSE_RESPONSE: "close.res",
  CANCEL_RESPONSE: "cancel.res",

  // REALTIME-SERVICE
  MARKET_PRICE_UPDATE: "market.price.update",

  // NOTIFICATION-SERVICE
  NOTIFY_CREATE: "create.notify",
  NOTIFY_MODIFY: "modify.notify",
  NOTIFY_CLOSE: "close.notify",
  NOTIFY_CANCEL: "cancel.notify",

  
 
};

export const TOPIC_LIST = [
  {
    topic: KAFKA_TOPICS.MATCHING_ENGINE,
    numPartinumPartitions: 3,
    replicationFactor: 1,
  },
  {
    topic: KAFKA_TOPICS.MATCHING_ENGINE_RESPONSE,
    numPartinumPartitions: 1,
    replicationFactor: 1,
  },
  {
    topic: KAFKA_TOPICS.REALTIME,
    numPartinumPartitions: 3,
    replicationFactor: 1,
  },
  {
  topic: KAFKA_TOPICS.NOTIFICATION,
  numPartinumPartitions: 3,
  replicationFactor: 1,
},
];
