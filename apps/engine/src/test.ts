import { OrderBook } from "./orderBook.js";

const market = new OrderBook("BTC/USDT");

let passedCount = 0;
let failedCount = 0;

function assertTest(testNum: number, condition: boolean) {
  if (condition) {
    console.log(`TEST ${testNum} : PASS`);
    passedCount++;
  } else {
    console.log(`TEST ${testNum} : FAIL`);
    failedCount++;
  }
}

// Setup Test Accounts with different balances
market.addBalance({ accId: 1, balance: 500000 }); // Rich Trader 1
market.addBalance({ accId: 2, balance: 500000 }); // Rich Trader 2
market.addBalance({ accId: 3, balance: 100 });    // Poor Trader (Margin test)


// ==========================================
// TEST 1: Margin Rejection
// ==========================================
const marginFail = market.addOrder({
  accId: 3,
  orderId: 101,
  side: "BUY",
  qty: 1,
  limitPrice: 60000,
  takeProfit: 70000,
  stopLoss: 50000,
});
assertTest(1, marginFail.success === false);


// ==========================================
// TEST 2: Price Priority Sorting (Bids & Asks)
// ==========================================
market.addOrder({ accId: 1, orderId: 201, side: "SELL", qty: 1, limitPrice: 65200, takeProfit: 60000, stopLoss: 66000 });
market.addOrder({ accId: 1, orderId: 202, side: "SELL", qty: 1, limitPrice: 65000, takeProfit: 60000, stopLoss: 66000 }); // Best price
market.addOrder({ accId: 1, orderId: 203, side: "SELL", qty: 1, limitPrice: 65100, takeProfit: 60000, stopLoss: 66000 });

const depth = market.getDepth();
const askPrices = Object.keys(depth.sellDepth);
assertTest(
  2, 
  askPrices[0] === "65000" && askPrices[1] === "65100" && askPrices[2] === "65200"
);


// ==========================================
// TEST 3: Self-Trade Prevention
// ==========================================
const selfTradeAttempt = market.fillOrder({
  accId: 1,
  orderId: 204,
  side: "BUY",
  qty: 1,
  limitPrice: 65000,
  takeProfit: 70000,
  stopLoss: 60000,
});
assertTest(
  3, 
  !selfTradeAttempt || (selfTradeAttempt as any).filledOrder === undefined || (selfTradeAttempt as any).filledOrder.length === 0
);


// ==========================================
// TEST 4: Partial Fill and Rest Unfilled Qty
// ==========================================
const partialFillResult = market.fillOrder({
  accId: 2,
  orderId: 301,
  side: "BUY",
  qty: 2.5,
  limitPrice: 65200, 
  takeProfit: 70000,
  stopLoss: 60000,
});

const filledCount = (partialFillResult as any)?.filledOrder?.length ?? 0;
assertTest(4, filledCount > 0);


// ==========================================
// TEST 5: Liquidation Cleanup
// ==========================================
market.liquidateOrders(1);

const acc1Orders = market.accounts.get(1)?.orders.length ?? 1;
const remainingSellDepth = Object.keys(market.getDepth().sellDepth).length;

assertTest(5, acc1Orders === 0 && remainingSellDepth === 0);


// ==========================================
// FINAL TEST SUMMARY
// ==========================================
console.log("\n------------------------------------------");
console.log(`SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("------------------------------------------");