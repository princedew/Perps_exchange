import { OrderBook } from "./orderBook.js";

// const btcUsdtBook = new OrderBook("BTC/USDT");

console.log("--- INITIALIZING BTC/USDT MARKET ---");
const btcUsdtBook = new OrderBook("BTC/USDT");

// 1. Add Initial Sell Orders (Asks)
btcUsdtBook.addOrder({
  accId: 101,
  orderId: 1,
  side: "SELL",
  qty: 2, // 2 BTC
  limitPrice: 65000,
  takeProfit: 60000,
  stopLoss: 66000,
});

btcUsdtBook.addOrder({
  accId: 102,
  orderId: 2,
  side: "SELL",
  qty: 1.5,
  limitPrice: 65100,
  takeProfit: 60000,
  stopLoss: 66200,
});

// 2. Add Initial Buy Orders (Bids)
btcUsdtBook.addOrder({
  accId: 103,
  orderId: 3,
  side: "BUY",
  qty: 1,
  limitPrice: 64800,
  takeProfit: 66000,
  stopLoss: 64000,
});

btcUsdtBook.addOrder({
  accId: 104,
  orderId: 4,
  side: "BUY",
  qty: 3,
  limitPrice: 64700,
  takeProfit: 66000,
  stopLoss: 63900,
});

console.log("\n--- CURRENT MARKET DEPTH ---");
console.log(JSON.stringify(btcUsdtBook.getDepth(), null, 2));

console.log("\n--- EXECUTING AN INCOMING BUY ORDER (Taking Liquidity) ---");
// Account 105 wants to buy 1 BTC at $65,000 (should match with Account 101's sell order)
const matchResult = btcUsdtBook.fillOrder({
  accId: 105,
  orderId: 5,
  side: "BUY",
  qty: 1,
  limitPrice: 65000,
  takeProfit: 67000,
  stopLoss: 64000,
});
console.log(JSON.stringify(matchResult, null, 2));

console.log("\n--- MARKET DEPTH AFTER MATCHING ---");
console.log(JSON.stringify(btcUsdtBook.getDepth(), null, 2));

console.log("\n--- TESTING LIQUIDATION (Liquidating Account 102) ---");
// Account 102 hit margin call, remove all their active orders
btcUsdtBook.liquidateOrders(102);

console.log("\n--- MARKET DEPTH AFTER LIQUIDATION ---");
console.log(JSON.stringify(btcUsdtBook.getDepth(), null, 2));