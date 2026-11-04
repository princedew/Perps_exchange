import * as sortedBTree from "sorted-btree";
import {
  Accounts,
  type AccId,
  type Position,
  type PositionId,
} from "../account.js";

const BTree = sortedBTree.default.default;

type MarketId = string;
type OrderId = number;
type Price = number;
type Quantity = number;
type QuoteBalance = number;

type BuyOrders = {
  accId: AccId;
  orderId: OrderId;
  side: "BUY";
  qty: Quantity;
  limitPrice: Price;
  takeProfit?: Price;
  stopLoss?: Price;
};

type SellOrders = {
  accId: AccId;
  orderId: OrderId;
  side: "SELL";
  qty: Quantity;
  limitPrice: Price;
  takeProfit?: Price;
  stopLoss?: Price;
};

type Order = BuyOrders | SellOrders;
type FilledOrder = Order;

type SpotPosition = Position;

type PriceLevel = {
  // Orders at the same price, in FIFO order.
  orders: Order[];
  head: number;
  totalQty: Quantity;
};

type TriggeredPosition = {
  accId: AccId;
  position: SpotPosition;
  trigger: "TAKE_PROFIT" | "STOP_LOSS";
  triggerPrice: Price;
};

type BalanceResult = { success: true } | { success: false; message: string };

type FillOrderResult =
  | {
      message: "FILLED";
      filledOrder: FilledOrder[];
    }
  | {
      message: "PARTIALLY_FILLED";
      filledOrder: FilledOrder[];
      remainingQty: Quantity;
    }
  | {
      message: "OPEN";
      orderId: OrderId;
      remainingQty: Quantity;
    }
  | {
      message: "SELF_TRADE_PREVENTED";
      filledOrder: FilledOrder[];
      remainingQty: Quantity;
    }
  | {
      success: false;
      message: string;
    };

type Depth = {
  buyDepth: Record<string, Quantity>;
  sellDepth: Record<string, Quantity>;
};

export class OrderBook {
  market: MarketId;
  currentPrice: Price;

  buyOrders: InstanceType<typeof BTree>;
  sellOrders: InstanceType<typeof BTree>;

  accounts: Accounts;

  constructor(market: MarketId, accounts: Accounts) {
    this.market = market;
    this.currentPrice = 0;

    this.buyOrders = new BTree<Price, PriceLevel>();
    this.sellOrders = new BTree<Price, PriceLevel>();

    this.accounts = accounts;
  }

  // -----------------------
  // CORE METHODS
  // -----------------------

  addBalance(data: { accId: AccId; balance: QuoteBalance }): void {
    this.accounts.addBalance(data.accId, data.balance);
  }

  fillOrder(data: Order): FillOrderResult {
    const balanceResult = this.hasBalance(data);

    if (!balanceResult.success) {
      return balanceResult;
    }

    const incomingOrder: Order = { ...data };
    const filledOrder: FilledOrder[] = [];

    const oppositeTree =
      incomingOrder.side === "BUY" ? this.sellOrders : this.buyOrders;

    while (incomingOrder.qty > 0) {
      const bestPrice =
        incomingOrder.side === "BUY"
          ? oppositeTree.minKey()
          : oppositeTree.maxKey();

      if (bestPrice === undefined) {
        break;
      }

      const priceLevel = oppositeTree.get(bestPrice);

      if (!priceLevel) {
        break;
      }

      const bestMatchOrder = priceLevel.orders[priceLevel.head];

      if (!bestMatchOrder) {
        break;
      }

      // LIMIT_PRICE_CHECK
      if (
        incomingOrder.side === "BUY"
          ? incomingOrder.limitPrice < bestPrice
          : incomingOrder.limitPrice > bestPrice
      ) {
        break;
      }

      if (incomingOrder.accId === bestMatchOrder.accId) {
        return {
          message: "SELF_TRADE_PREVENTED",
          filledOrder,
          remainingQty: incomingOrder.qty,
        };
      }

      const tradeQty = Math.min(incomingOrder.qty, bestMatchOrder.qty);

      const buyOrder =
        incomingOrder.side === "BUY" ? incomingOrder : bestMatchOrder;

      const sellOrder =
        incomingOrder.side === "SELL" ? incomingOrder : bestMatchOrder;

      filledOrder.push(
        {
          ...buyOrder,
          qty: tradeQty,
        },
        {
          ...sellOrder,
          qty: tradeQty,
        },
      );

      this.settleTrade(buyOrder, sellOrder, tradeQty, bestPrice);

      incomingOrder.qty -= tradeQty;
      bestMatchOrder.qty -= tradeQty;
      priceLevel.totalQty -= tradeQty;

      if (bestMatchOrder.qty === 0) {
        priceLevel.head++;
      }

      this.currentPrice = bestPrice;

      this.removeFilledOrder(oppositeTree, bestPrice, priceLevel);
    }

    if (incomingOrder.qty > 0) {
      this.addOrderToTree(incomingOrder);

      if (filledOrder.length > 0) {
        return {
          message: "PARTIALLY_FILLED",
          filledOrder,
          remainingQty: incomingOrder.qty,
        };
      }

      // this return work if the LIMIT_PRICE_CHECK truthy.
      return {
        message: "OPEN",
        orderId: incomingOrder.orderId,
        remainingQty: incomingOrder.qty,
      };
    }

    return {
      message: "FILLED",
      filledOrder,
    };
  }

  getTriggeredPositions(currentPrice: Price): TriggeredPosition[] {
    const triggeredPositions: TriggeredPosition[] = [];

    for (const [accId, account] of this.accounts.entries()) {
      const positions = account.positions.get("SPOT");

      if (!positions) {
        continue;
      }

      for (const position of positions.values()) {
        if (position.market !== this.market) {
          continue;
        }

        // Stop-loss: close a BUY position when price falls to this level.
        if (
          position.stopLoss !== undefined &&
          currentPrice <= position.stopLoss
        ) {
          triggeredPositions.push({
            accId,
            position,
            trigger: "STOP_LOSS",
            triggerPrice: position.stopLoss,
          });

          continue;
        }

        // Take-profit: close a BUY position when price reaches this level.
        if (
          position.takeProfit !== undefined &&
          currentPrice >= position.takeProfit
        ) {
          triggeredPositions.push({
            accId,
            position,
            trigger: "TAKE_PROFIT",
            triggerPrice: position.takeProfit,
          });
        }
      }
    }

    return triggeredPositions;
  }

  liquidateOrdersFromBothOrderTrees(accId: AccId): void {
    this.liquidateOrdersFromTree(this.buyOrders, accId);
    this.liquidateOrdersFromTree(this.sellOrders, accId);
  }

  getDepth(): Depth {
    const buyDepth: Record<string, Quantity> = {};
    const sellDepth: Record<string, Quantity> = {};

    for (const [price, level] of this.buyOrders.entriesReversed()) {
      buyDepth[price] = level.totalQty;
    }

    for (const [price, level] of this.sellOrders.entries()) {
      sellDepth[price] = level.totalQty;
    }

    return {
      buyDepth,
      sellDepth,
    };
  }

  // --------------------------------
  // HELPER METHODS
  // --------------------------------

  private hasBalance(data: Order): BalanceResult {
    const account = this.accounts.get(data.accId);

    if (!account) {
      return {
        success: false,
        message: "Account not found.",
      };
    }

    if (data.side === "BUY") {
      const requiredBalance = data.qty * data.limitPrice;

      if (account.availableMargin < requiredBalance) {
        return {
          success: false,
          message: "Insufficient Balance",
        };
      }
    } else {
      const availableQty = this.getAvailableQty(data.accId);

      if (availableQty < data.qty) {
        return {
          success: false,
          message: "Insufficient Quantity",
        };
      }
    }

    return { success: true };
  }

  private getAvailableQty(accId: AccId): Quantity {
    const positions = this.accounts.getPositions(accId, "SPOT");

    if (!positions) {
      return 0;
    }

    let positionQty = 0;
    let openSellQty = 0;

    for (const position of positions.values()) {
      if (position.market === this.market) {
        positionQty += position.qty;
      }
    }


    for (const [price, level] of this.sellOrders.entries()) {
      for (let i = level.head; i < level.orders.length; i++) {
        const order = level.orders[i];

        if (order?.accId === accId) {
          openSellQty += order.qty;
        }
      }
    }

    return positionQty - openSellQty;
  }

  // 
  private settleTrade(
    buyOrder: BuyOrders,
    sellOrder: SellOrders,
    qty: Quantity,
    executionPrice: Price,
  ): void {
    const buyer = this.accounts.get(buyOrder.accId);
    const seller = this.accounts.get(sellOrder.accId);

    if (!buyer || !seller) {
      throw new Error("Buyer or seller account not found.");
    }

    const tradeValue = qty * executionPrice;

    // BUYER SETTLEMENT
    buyer.balance -= tradeValue;

    this.addSpotPosition(buyOrder, qty, executionPrice);

    // SELLER SETTLEMENT
    seller.balance += tradeValue;

    this.reduceSpotPosition(sellOrder.accId, qty);
  }

  private addSpotPosition(
    order: BuyOrders,
    qty: Quantity,
    executionPrice: Price,
  ): void {
    const existingPositions = this.accounts.getPositions(order.accId, "SPOT");

    const positionId: PositionId = this.market;

    const existingPosition = existingPositions?.get(positionId);

    const previousQty = existingPosition?.qty ?? 0;
    const newQty = previousQty + qty;

    const averageEntryPrice =
      previousQty === 0
        ? executionPrice
        : (previousQty * (existingPosition?.entryPrice ?? 0) +
            qty * executionPrice) /
          newQty;

    const position: SpotPosition = {
      positionId,
      market: this.market,
      side: "LONG",
      entryPrice: averageEntryPrice,
      qty: newQty,
      leverage: 1,
      margin: 0,
      unrealizedPnl: 0,
      liquidationPrice: 0,
      ...(order.takeProfit !== undefined
        ? { takeProfit: order.takeProfit }
        : existingPosition?.takeProfit !== undefined
          ? { takeProfit: existingPosition.takeProfit }
          : {}),
      ...(order.stopLoss !== undefined
        ? { stopLoss: order.stopLoss }
        : existingPosition?.stopLoss !== undefined
          ? { stopLoss: existingPosition.stopLoss }
          : {}),
    };

    this.accounts.addPosition(order.accId, position, "SPOT");
  }

  private reduceSpotPosition(accId: AccId, qty: Quantity): void {
    const positionId: PositionId = this.market;

    const position = this.accounts.getPosition(accId, "SPOT", positionId);

    if (!position) {
      throw new Error(
        `Spot position not found for account ${accId} in ${this.market}.`,
      );
    }

    if (position.qty < qty) {
      throw new Error("Insufficient Spot position quantity.");
    }

    const remainingQty = position.qty - qty;

    if (remainingQty === 0) {
      this.accounts.removePosition(accId, positionId, "SPOT");

      return;
    }

    this.accounts.addPosition(
      accId,
      {
        ...position,
        qty: remainingQty,
      },
      "SPOT",
    );
  }

  private addOrderToTree(order: Order): void {
    const tree = order.side === "BUY" ? this.buyOrders : this.sellOrders;

    const priceLevel = tree.get(order.limitPrice);

    if (priceLevel) {
      priceLevel.orders.push(order);
      priceLevel.totalQty += order.qty;
      return;
    }

    tree.set(order.limitPrice, {
      orders: [order],
      head: 0,
      totalQty: order.qty,
    });
  }

  private removeFilledOrder(
    tree: BTree<Price, PriceLevel>,
    price: Price,
    level: PriceLevel,
  ): void {
    if (level.head >= level.orders.length) {
      tree.delete(price);
      return;
    }

    // Compact the array occasionally instead of shifting on every fill.
    if (level.head >= 64 && level.head * 2 >= level.orders.length) {
      level.orders = level.orders.slice(level.head);
      level.head = 0;
    }

    tree.set(price, level);
  }

  private liquidateOrdersFromTree(
    tree: BTree<Price, PriceLevel>,
    accId: AccId,
  ): void {
    const priceLevels = Array.from(tree.entries());

    for (const [price, level] of priceLevels) {
      const remainingOrders = level.orders.slice(level.head);

      const filteredOrders = remainingOrders.filter(
        (order) => order.accId !== accId,
      );

      if (filteredOrders.length === 0) {
        tree.delete(price);
        continue;
      }

      level.orders = filteredOrders;
      level.head = 0;
      level.totalQty = filteredOrders.reduce(
        (total, order) => total + order.qty,
        0,
      );

      tree.set(price, level);
    }
  }
}
