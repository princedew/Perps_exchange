import { consumer } from "../consumer.js";
import { resolvePendingRequest } from "./pendingRequest.js";
import { z } from "zod";

const MatchingResponseSchema = z.object({
  reqId: z.uuid(),
  filledQty: z.number().nonnegative(),
});

export async function revokeHold(): Promise<void> {
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;

      try {
        const reqId = message.key.toString();

        const rawData: unknown = JSON.parse(message.value.toString());

        const result = MatchingResponseSchema.safeParse(rawData);

        if (!result.success) {
          console.error("Invalid matching response:", result.error);
          return;
        }

        const { filledQty } = result.data;

        resolvePendingRequest(reqId, filledQty);
      } catch (error: unknown) {
        console.error("Failed to process matching response:", error);
      }
    },
  });
}
