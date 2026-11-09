// realtime/src/websocket.ts

// Here u have to create a ws server, the client(fe) will connect we authenthicate on http connection upgrade, user will send the jwt token in cookie on decode we will get {accId} we will map it with ws connection using Map<accId, ws>();

// From the client side we are going to receive the listenMarketMessage, which Market's data the client want to see on charts so on ws messaage we will receive {accId, markets:["BTC/USDT", "SOL/USDT"]}, we will map it Map<Market like "BTC/USDT", accId[]>.
// There will be 2 map the accId: ws map and second market: accId array, here market will be string like BTC/USDT etc, etc so that we can get like map.get("BTC/USDT");

// u should make 2 fn one will add accId in array of accId in market map and another remove it.
// u should perform these action in different fn's like addAccountAndSocket(...), broadCast(data) uniCast(accId, data).

// dont only mention "string" make a type AccId: string then use AccId instead of string.

// there should also be a fn that send the market update to acc, we will use this fn on kafka consumer (realtime/src/main.ts) when consumer receive that market Update for any specific market we will use this fn.


import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { redis } from "@repo/redis";


// -------------------- Types --------------------

export type AccId = string;
export type Market = string;

type JwtPayload = {
  accId: AccId;
};

type ListenMarketMessage = {
  type: "LISTEN_MARKET";
  accId: AccId;
  markets: Market[];
};

// -------------------- Schemas --------------------

const jwtPayloadSchema = z.object({
  accId: z.string().min(1),
});

const listenMarketMessageSchema = z.object({
  type: z.literal("LISTEN_MARKET"),
  accId: z.string().min(1),
  markets: z.array(z.string().min(1)),
});

// -------------------- Configuration --------------------

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not defined");
}

// -------------------- Maps --------------------

// accId -> WebSocket connection
const accountSockets = new Map<AccId, WebSocket>();

// market -> accounts listening to that market
const marketAccounts = new Map<Market, AccId[]>();

// -------------------- Server --------------------

export const httpServer: Server = createServer();

export const wss: WebSocketServer = new WebSocketServer({
  noServer: true,
});

// -------------------- Cookie / JWT --------------------

function getTokenFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split("=");

    if (key === "token") {
      return decodeURIComponent(value.join("="));
    }
  }

  return null;
}

function authenticateToken(token: string): JwtPayload | null {
  try {
    const decoded: unknown = jwt.verify(token, JWT_SECRET);

    const result = jwtPayloadSchema.safeParse(decoded);

    if (!result.success) {
      console.error("Invalid JWT payload:", result.error.issues);
      return null;
    }

    return result.data;
  } catch (error: unknown) {
    console.error("JWT authentication failed:", error);
    return null;
  }
}

// -------------------- Account / Socket --------------------

export function addAccountAndSocket(
  accId: AccId,
  ws: WebSocket,
): void {
  const existingSocket = accountSockets.get(accId);

  if (existingSocket) {
    existingSocket.close(1000, "New connection established");
  }

  accountSockets.set(accId, ws);

  console.log(`Account connected: ${accId}`);
}

export function removeAccountAndSocket(
  accId: AccId,
  ws: WebSocket,
): void {
  // Prevent an old connection from deleting a newer connection.
  if (accountSockets.get(accId) !== ws) return;

  accountSockets.delete(accId);

  // Remove this account from all market subscriptions.
  for (const [market, accounts] of marketAccounts.entries()) {
    removeAccountFromMarket(market, accId);
  }

  console.log(`Account disconnected: ${accId}`);
}

// -------------------- Market / Account Mapping --------------------

export function addAccountToMarket(
  market: Market,
  accId: AccId,
): void {
  const accounts = marketAccounts.get(market);

  if (accounts) {
    if (!accounts.includes(accId)) {
      accounts.push(accId);
    }

    return;
  }

  marketAccounts.set(market, [accId]);
}

export function removeAccountFromMarket(
  market: Market,
  accId: AccId,
): void {
  const accounts = marketAccounts.get(market);

  if (!accounts) return;

  const updatedAccounts = accounts.filter(
    (accountId) => accountId !== accId,
  );

  if (updatedAccounts.length === 0) {
    marketAccounts.delete(market);
    return;
  }

  marketAccounts.set(market, updatedAccounts);
}

// -------------------- Send Messages --------------------

function sendJson(ws: WebSocket, data: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify(data));
}

export function broadCast(data: unknown): void {
  for (const ws of accountSockets.values()) {
    sendJson(ws, data);
  }
}

export function uniCast(
  accId: AccId,
  data: unknown,
): void {
  const ws = accountSockets.get(accId);

  if (!ws) return;

  sendJson(ws, data);
}

// -------------------- Listen Market Message --------------------

function handleListenMarketMessage(
  accId: AccId,
  message: ListenMarketMessage,
): void {
  for (const market of message.markets) {
    addAccountToMarket(market, accId);
  }

  uniCast(accId, {
    type: "LISTEN_MARKET_RESPONSE",
    success: true,
    markets: message.markets,
  });
}

function handleMessage(
  accId: AccId,
  ws: WebSocket,
  rawMessage: RawData,
): void {
  let payload: unknown;

  try {
    payload = JSON.parse(rawMessage.toString());
  } catch (error: unknown) {
    console.error("Invalid WebSocket JSON:", error);

    uniCast(accId, {
      type: "ERROR",
      message: "INVALID_JSON",
    });

    return;
  }

  const result = listenMarketMessageSchema.safeParse(payload);

  if (!result.success) {
    uniCast(accId, {
      type: "ERROR",
      message: "INVALID_MESSAGE",
      issues: result.error.issues,
    });

    return;
  }

  const message = result.data;

  // The account ID must come from the authenticated JWT.
  if (message.accId !== accId) {
    sendJson(ws, {
      type: "ERROR",
      message: "ACCOUNT_MISMATCH",
    });

    return;
  }

  switch (message.type) {
    case "LISTEN_MARKET": {
      handleListenMarketMessage(accId, message);
      break;
    }
  }
}

// -------------------- Market Updates --------------------

/**
 * Called by the Kafka consumer when a market update arrives.
 * Sends the update to every account listening to that market.
 */
export function sendMarketUpdate(
  market: Market,
  data: unknown,
): void {
  const accounts = marketAccounts.get(market);

  if (!accounts) return;

  for (const accId of accounts) {
    uniCast(accId, {
      type: "MARKET_UPDATE",
      market,
      data,
    });
  }
}

// -------------------- HTTP Upgrade --------------------

httpServer.on("upgrade", (request, socket, head) => {
  const token = getTokenFromCookie(request.headers.cookie);

  if (!token) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const payload = authenticateToken(token);

  if (!payload) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    const accId = payload.accId;

    addAccountAndSocket(accId, ws);

    ws.on("message", (message: RawData) => {
      handleMessage(accId, ws, message);
    });

    ws.on("close", () => {
      removeAccountAndSocket(accId, ws);
    });

    ws.on("error", (error: Error) => {
      console.error(`WebSocket error for ${accId}:`, error);
      removeAccountAndSocket(accId, ws);
    });

    sendJson(ws, {
      type: "CONNECTED",
      accId,
    });
  });
});

// -------------------- Start Server --------------------

export async function startWebSocketServer(
  port: number = 8000,
): Promise<void> {
  httpServer.listen(port, () => {
    console.log(`WebSocket server listening on port ${port}`);
  });
}