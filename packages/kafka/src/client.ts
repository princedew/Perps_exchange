import {Kafka} from "kafkajs";

export const kafka = new Kafka({
    clientId:"perps",
    brokers:["localhost:9092"]
})

export const producer = kafka.producer();