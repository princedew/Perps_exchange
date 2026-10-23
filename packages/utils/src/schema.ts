import z from "zod";

export const createOrderSchema = {
  body: z.object({
    accId: z.number().int().positive(),
    marketId: z.number().int().positive(),

    type: z.enum(["MARKET", "LIMIT"]),
    side: z.enum(["BUY", "SELL"]),

    quantity: z.number().positive(),
    leverage: z.number().positive().optional(),

    limitPrice: z.number().positive().optional(),
    takeProfit: z.number().positive().optional(),
    stopLoss: z.number().positive().optional(),
  }),
};