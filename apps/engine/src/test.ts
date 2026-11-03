import { OrderBook } from "./orderBook.js";

let passedCount = 0;
let failedCount = 0;

function assertTest(testNum: number, condition: boolean): void {
  if (condition) {
    console.log(`TEST ${testNum}: PASS`);
    passedCount++;
  } else {
    console.log(`TEST ${testNum}: FAIL`);
    failedCount++;
  }
}

function createMarket(): OrderBook {
  const market = new OrderBook("BTC/USDT");

  market.addBalance({ accId: 1, balance: 500_000 });
  market.addBalance({ accId: 2, balance: 500_000 });
  market.addBalance({ accId: 3, balance: 100 });

  return market;
}

// Test fixture helper: give an account some BTC inventory.
function giveBaseAsset(
  market: OrderBook,
  accId: number,
  qty: number,
  orderId: number,
): void {
  const account = market.accounts.get(accId);

  if (!account) {
    throw new Error(`Account ${accId} not found`);
  }

  account.positions.add({
    orderId,
    qty,
    limitPrice: 60_000,
  });
}

// ==========================================
// TEST 1: Insufficient Quote Balance
// ==========================================
{
  const market = createMarket();

  const result = market.fillOrder({
    accId: 3,
    orderId: 101,
    side: "BUY",
    qty: 1,
    limitPrice: 60_000,
  });

  assertTest(
    1,
    "success" in result && result.success === false,
  );
}

// ==========================================
// TEST 2: Price Priority
// ==========================================
{
  const market = createMarket();

  giveBaseAsset(market, 1, 3, 1001);

  market.addOrder({
    accId: 1,
    orderId: 201,
    side: "SELL",
    qty: 1,
    limitPrice: 65_200,
  });

  market.addOrder({
    accId: 1,
    orderId: 202,
    side: "SELL",
    qty: 1,
    limitPrice: 65_000,
  });

  market.addOrder({
    accId: 1,
    orderId: 203,
    side: "SELL",
    qty: 1,
    limitPrice: 65_100,
  });

  const depth = market.getDepth();
  const askPrices = Object.keys(depth.sellDepth);

  assertTest(
    2,
    askPrices[0] === "65000" &&
      askPrices[1] === "65100" &&
      askPrices[2] === "65200",
  );
}

// ==========================================
// TEST 3: Self-Trade Prevention
// ==========================================
{
  const market = createMarket();

  giveBaseAsset(market, 1, 1, 1001);

  market.addOrder({
    accId: 1,
    orderId: 301,
    side: "SELL",
    qty: 1,
    limitPrice: 65_000,
  });

  const result = market.fillOrder({
    accId: 1,
    orderId: 302,
    side: "BUY",
    qty: 1,
    limitPrice: 65_000,
  });

  assertTest(
    3,
    result.message === "SELF_TRADE_PREVENTED" &&
      result.filledOrder.length === 0,
  );
}

// ==========================================
// TEST 4: Partial Fill + Incoming Remainder
// ==========================================
{
  const market = createMarket();

  giveBaseAsset(market, 1, 1.5, 1001);

  market.addOrder({
    accId: 1,
    orderId: 401,
    side: "SELL",
    qty: 1,
    limitPrice: 65_000,
  });

  market.addOrder({
    accId: 1,
    orderId: 402,
    side: "SELL",
    qty: 0.5,
    limitPrice: 65_100,
  });

  const result = market.fillOrder({
    accId: 2,
    orderId: 403,
    side: "BUY",
    qty: 2.5,
    limitPrice: 65_200,
  });

  const remainingBuyQty = market.getDepth().buyDepth["65200"];

  assertTest(
    4,
    result.message === "PARTIALLY_FILLED" &&
      result.remainingQty === 1 &&
      remainingBuyQty === 1,
  );
}

// ==========================================
// TEST 5: Account Order Cancellation
// ==========================================
{
  const market = createMarket();

  giveBaseAsset(market, 1, 1, 1001);
  giveBaseAsset(market, 2, 1, 1002);

  market.addOrder({
    accId: 1,
    orderId: 501,
    side: "SELL",
    qty: 1,
    limitPrice: 65_000,
  });

  market.addOrder({
    accId: 2,
    orderId: 502,
    side: "SELL",
    qty: 1,
    limitPrice: 65_100,
  });

  market.cancelOrdersForAccount(1);

  const depth = market.getDepth();

  assertTest(
    5,
    depth.sellDepth["65000"] === undefined &&
      depth.sellDepth["65100"] === 1,
  );
}

// ==========================================
// TEST 6: Fully Filled Order + Settlement
// ==========================================
{
  const market = createMarket();

  giveBaseAsset(market, 1, 1, 1001);

  market.addOrder({
    accId: 1,
    orderId: 601,
    side: "SELL",
    qty: 1,
    limitPrice: 65_000,
  });

  const result = market.fillOrder({
    accId: 2,
    orderId: 602,
    side: "BUY",
    qty: 1,
    limitPrice: 65_000,
    takeProfit: 70_000,
    stopLoss: 60_000,
  });

  const buyer = market.accounts.get(2);

  assertTest(
    6,
    result.message === "FILLED" &&
      buyer?.balance === 435_000 &&
      buyer.positions.size === 1 &&
      market.getDepth().sellDepth["65000"] === undefined,
  );
}

// ==========================================
// TEST 7: Take-Profit / Stop-Loss Detection
// ==========================================
{
  const market = createMarket();

  giveBaseAsset(market, 1, 1, 1001);

  market.addOrder({
    accId: 1,
    orderId: 701,
    side: "SELL",
    qty: 1,
    limitPrice: 65_000,
  });

  market.fillOrder({
    accId: 2,
    orderId: 702,
    side: "BUY",
    qty: 1,
    limitPrice: 65_000,
    takeProfit: 70_000,
    stopLoss: 60_000,
  });

  const stopLossTriggered = market.getTriggeredPositions(59_000);
  const takeProfitTriggered = market.getTriggeredPositions(71_000);

  assertTest(
    7,
    stopLossTriggered[0]?.trigger === "STOP_LOSS" &&
      takeProfitTriggered[0]?.trigger === "TAKE_PROFIT",
  );
}

// ==========================================
// FINAL TEST SUMMARY
// ==========================================
console.log("\n------------------------------------------");
console.log(`SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("------------------------------------------");