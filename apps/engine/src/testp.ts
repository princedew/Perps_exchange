import { PerpsFutureOrderBook } from "./perpsOrderBook2.js";

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

function createMarket(): PerpsFutureOrderBook {
  const market = new PerpsFutureOrderBook("BTC/USDT");

  market.accounts.ensure(1, 100_000);
  market.accounts.ensure(2, 100_000);
  market.accounts.ensure(3, 100);

  return market;
}

function openLongAndShort(
  market: PerpsFutureOrderBook,
  longAccId = 1,
  shortAccId = 2,
  longPositionId = "long-1",
  shortPositionId = "short-1",
): void {
  market.fillOrder({
    accId: shortAccId,
    orderId: 101,
    positionId: shortPositionId,
    side: "SELL",
    direction: "SHORT",
    qty: 1,
    leverage: 10,
    limitPrice: 60_000,
  });

  market.fillOrder({
    accId: longAccId,
    orderId: 102,
    positionId: longPositionId,
    side: "BUY",
    direction: "LONG",
    qty: 1,
    leverage: 10,
    limitPrice: 60_000,
  });
}

// ==========================================
// TEST 1: Insufficient Available Margin
// ==========================================
{
  const market = createMarket();

  const result = market.fillOrder({
    accId: 3,
    orderId: 201,
    positionId: "small-account-long",
    side: "BUY",
    direction: "LONG",
    qty: 1,
    leverage: 1,
    limitPrice: 60_000,
  });

  assertTest(
    1,
    "success" in result &&
      result.success === false &&
      result.message === "Insufficient available margin.",
  );
}

// ==========================================
// TEST 2: Open LONG and SHORT Positions
// ==========================================
{
  const market = createMarket();

  const result = market.fillOrder({
    accId: 1,
    orderId: 301,
    positionId: "long-301",
    side: "BUY",
    direction: "LONG",
    qty: 1,
    leverage: 10,
    limitPrice: 60_000,
  });

  const makerResult = market.fillOrder({
    accId: 2,
    orderId: 302,
    positionId: "short-302",
    side: "SELL",
    direction: "SHORT",
    qty: 1,
    leverage: 10,
    limitPrice: 60_000,
  });

  const longPosition = market.accounts.getPosition(1, "PERPS", "long-301");

  const shortPosition = market.accounts.getPosition(2, "PERPS", "short-302");

  assertTest(
    2,
    result.message === "OPEN" &&
      makerResult.message === "FILLED" &&
      longPosition?.side === "LONG" &&
      longPosition.qty === 1 &&
      shortPosition?.side === "SHORT" &&
      shortPosition.qty === 1,
  );
}

// ==========================================
// TEST 3: Close LONG and SHORT Positions
// ==========================================
{
  const market = createMarket();

  openLongAndShort(market);

  // Account 1 closes its LONG; account 2 closes its SHORT.
  market.fillOrder({
    accId: 1,
    orderId: 401,
    positionId: "long-1",
    side: "SELL",
    direction: "LONG",
    qty: 1,
    leverage: 10,
    limitPrice: 60_000,
  });

  const result = market.fillOrder({
    accId: 2,
    orderId: 402,
    positionId: "short-1",
    side: "BUY",
    direction: "SHORT",
    qty: 1,
    leverage: 10,
    limitPrice: 60_000,
  });

  assertTest(
    3,
    result.message === "FILLED" &&
      market.accounts.getPosition(1, "PERPS", "long-1") === undefined &&
      market.accounts.getPosition(2, "PERPS", "short-1") === undefined,
  );
}

// ==========================================
// TEST 4: Partial Fill and Remaining Depth
// ==========================================
{
  const market = createMarket();

  market.fillOrder({
    accId: 1,
    orderId: 501,
    positionId: "short-501",
    side: "SELL",
    direction: "SHORT",
    qty: 1,
    leverage: 10,
    limitPrice: 60_000,
  });

  const result = market.fillOrder({
    accId: 2,
    orderId: 502,
    positionId: "long-502",
    side: "BUY",
    direction: "LONG",
    qty: 2,
    leverage: 10,
    limitPrice: 60_000,
  });

  const depth = market.getDepth();

  assertTest(
    4,
    result.message === "PARTIALLY_FILLED" &&
      result.remainingQty === 1 &&
      depth.buyDepth["60000"] === 1 &&
      depth.sellDepth["60000"] === undefined,
  );
}

// ==========================================
// TEST 5: Self-Trade Prevention
// ==========================================
{
  const market = createMarket();

  market.fillOrder({
    accId: 1,
    orderId: 601,
    positionId: "short-601",
    side: "SELL",
    direction: "SHORT",
    qty: 1,
    leverage: 10,
    limitPrice: 60_000,
  });

  const result = market.fillOrder({
    accId: 1,
    orderId: 602,
    positionId: "long-602",
    side: "BUY",
    direction: "LONG",
    qty: 1,
    leverage: 10,
    limitPrice: 60_000,
  });

  assertTest(
    5,
    result.message === "SELF_TRADE_PREVENTED" &&
      result.filledOrder.length === 0 &&
      market.getDepth().sellDepth["60000"] === 1,
  );
}

// ==========================================
// TEST 6: Price Priority
// ==========================================
{
  const market = createMarket();

  market.fillOrder({
    accId: 1,
    orderId: 701,
    positionId: "short-701",
    side: "SELL",
    direction: "SHORT",
    qty: 1,
    leverage: 10,
    limitPrice: 60_200,
  });

  market.fillOrder({
    accId: 1,
    orderId: 702,
    positionId: "short-702",
    side: "SELL",
    direction: "SHORT",
    qty: 1,
    leverage: 10,
    limitPrice: 60_000,
  });

  market.fillOrder({
    accId: 1,
    orderId: 703,
    positionId: "short-703",
    side: "SELL",
    direction: "SHORT",
    qty: 1,
    leverage: 10,
    limitPrice: 60_100,
  });

  const depth = market.getDepth();
  const askPrices = Object.keys(depth.sellDepth);

  assertTest(
    6,
    askPrices[0] === "60000" &&
      askPrices[1] === "60100" &&
      askPrices[2] === "60200",
  );
}

// ==========================================
// TEST 7: Account Order Cancellation
// ==========================================
{
  const market = createMarket();

  market.fillOrder({
    accId: 1,
    orderId: 801,
    positionId: "short-801",
    side: "SELL",
    direction: "SHORT",
    qty: 1,
    leverage: 10,
    limitPrice: 60_000,
  });

  market.fillOrder({
    accId: 2,
    orderId: 802,
    positionId: "short-802",
    side: "SELL",
    direction: "SHORT",
    qty: 1,
    leverage: 10,
    limitPrice: 60_100,
  });

  market.liquidateOrdersFromBothOrderTrees(1);

  const depth = market.getDepth();

  assertTest(
    7,
    depth.sellDepth["60000"] === undefined && depth.sellDepth["60100"] === 1,
  );
}

// ==========================================
// TEST 8: LONG Stop-Loss and Take-Profit
// ==========================================
{
  const market = createMarket();

  market.fillOrder({
    accId: 1,
    orderId: 901,
    positionId: "long-901",
    side: "BUY",
    direction: "LONG",
    qty: 1,
    leverage: 10,
    limitPrice: 60_000,
    takeProfit: 70_000,
    stopLoss: 55_000,
  });

  market.fillOrder({
    accId: 2,
    orderId: 902,
    positionId: "short-902",
    side: "SELL",
    direction: "SHORT",
    qty: 1,
    leverage: 10,
    limitPrice: 60_000,
  });

  const stopLoss = market.getTriggeredPositions(54_000);
  const takeProfit = market.getTriggeredPositions(71_000);

  assertTest(
    8,
    stopLoss.some(
      (triggered) =>
        triggered.position.positionId === "long-901" &&
        triggered.trigger === "STOP_LOSS",
    ) &&
      takeProfit.some(
        (triggered) =>
          triggered.position.positionId === "long-901" &&
          triggered.trigger === "TAKE_PROFIT",
      ),
  );
}

// ==========================================
// FINAL TEST SUMMARY
// ==========================================
console.log("\n------------------------------------------");
console.log(`SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("------------------------------------------");
