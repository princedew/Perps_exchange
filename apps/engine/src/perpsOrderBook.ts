import * as sortedBTree from "sorted-btree";
import {
  Accounts,
  type AccId,
  type Position,
  type PositionId,
  type MarketType,
} from "./account.js";

const BTree = sortedBTree.default.default;

type MarketId = string;
type OrderId = number;
type Price = number;
type Quantity = number;

type BuyOrders = {
  accId: AccId;
  orderId: OrderId;
  positionId?: PositionId;
  direction: "LONG" | "SHORT";
  side: "BUY";
  qty: Quantity;
  leverage: number;
  limitPrice: Price;
  takeProfit?: Price;
  stopLoss?: Price;
};

type SellOrders = {
  accId: AccId;
  orderId: OrderId;
  positionId?: PositionId;
  direction: "LONG" | "SHORT";
  side: "SELL";
  qty: Quantity;
  leverage: number;
  limitPrice: Price;
  takeProfit?: Price;
  stopLoss?: Price;
};

type Order = BuyOrders | SellOrders;
type FilledOrder = Order;

type PriceLevel = {
  orders: Order[];
  head: number;
  totalQty: Quantity;
};

type TriggeredPosition = {
  accId: AccId;
  position: Position;
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

export class PerpsFutureOrderBook {
  market: MarketId;
  currentPrice: Price;

  buyOrders: InstanceType<typeof BTree>;
  sellOrders: InstanceType<typeof BTree>;

  accounts: Accounts;

  constructor(market: MarketId, accounts: Accounts = new Accounts()) {
    this.market = market;
    this.currentPrice = 0;

    this.buyOrders = new BTree<Price, PriceLevel>();
    this.sellOrders = new BTree<Price, PriceLevel>();

    this.accounts = accounts;
  }

  fillOrder3(data: Order): FillOrderResult {
    const balanceResult = this.hasBalance(data);

    if (!balanceResult.success) {
      return balanceResult;
    }

    // Closing orders must specify the position they want to close.
    if (
      (data.side === "SELL" && data.direction === "LONG") ||
      (data.side === "BUY" && data.direction === "SHORT")
    ) {
      if (data.positionId === undefined) {
        return {
          success: false,
          message: "Position ID is required to close a position.",
        };
      }
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

      if (bestPrice === undefined) break;

      const priceLevel = oppositeTree.get(bestPrice);
      if (!priceLevel) break;

      const bestMatchOrder = priceLevel.orders[priceLevel.head];
      if (!bestMatchOrder) break;

      if (
        incomingOrder.side === "BUY"
          ? incomingOrder.limitPrice < bestPrice
          : incomingOrder.limitPrice > bestPrice
      ) {
        break;
      }

      // Prevent an account from trading against itself.
      if (incomingOrder.accId === bestMatchOrder.accId) {
        return {
          message: "SELF_TRADE_PREVENTED",
          filledOrder,
          remainingQty: incomingOrder.qty,
        };
      }

      const matchedQty = Math.min(incomingOrder.qty, bestMatchOrder.qty);

      const buyerOrder: Order =
        incomingOrder.side === "BUY" ? incomingOrder : bestMatchOrder;

      const sellerOrder: Order =
        incomingOrder.side === "SELL" ? incomingOrder : bestMatchOrder;

      const buyerFill: FilledOrder = {
        ...buyerOrder,
        qty: matchedQty,
      };

      const sellerFill: FilledOrder = {
        ...sellerOrder,
        qty: matchedQty,
      };

      filledOrder.push(buyerFill, sellerFill);

      if (buyerFill.direction === "LONG") {
        this.openLongPositionInAccount(buyerFill, bestPrice);
      } else if (buyerFill.direction === "SHORT") {
        this.closeShortPositionInAccount(buyerFill);
      }

      if (sellerFill.direction === "LONG") {
        this.closeLongPositionInAccount(sellerFill);
      } else if (sellerFill.direction === "SHORT") {
        this.openShortPositionInAccount(sellerFill, bestPrice);
      }

      incomingOrder.qty -= matchedQty;
      bestMatchOrder.qty -= matchedQty;

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
      const positions = account.positions.get("PERPS");
      if (!positions) continue;

      for (const position of positions.values()) {
        if (position.market !== this.market) continue;

        const stopLossTriggered =
          position.side === "LONG"
            ? position.stopLoss !== undefined &&
              currentPrice <= position.stopLoss
            : position.stopLoss !== undefined &&
              currentPrice >= position.stopLoss;

        const takeProfitTriggered =
          position.side === "LONG"
            ? position.takeProfit !== undefined &&
              currentPrice >= position.takeProfit
            : position.takeProfit !== undefined &&
              currentPrice <= position.takeProfit;

        if (stopLossTriggered) {
          triggeredPositions.push({
            accId,
            position,
            trigger: "STOP_LOSS",
            triggerPrice: position.stopLoss!,
          });
        } else if (takeProfitTriggered) {
          triggeredPositions.push({
            accId,
            position,
            trigger: "TAKE_PROFIT",
            triggerPrice: position.takeProfit!,
          });
        }
      }
    }

    return triggeredPositions;
  }

  // LIQ. ORDER FROM BOTH BUY AND SELL SIDE TREE.
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

    return { buyDepth, sellDepth };
  }

  //---------------------------
  // HEALPER METHODS
  //---------------------------

  // PROBLEM: WE SHOULD LOOP OVER ACC SPOT AND PERPS ORDER.
  // CHECK THE USER HAS BALANCE OR NOT.
  private hasBalance(data: Order): BalanceResult {
    const account = this.accounts.get(data.accId);

    if (!account) {
      return {
        success: false,
        message: "Account not found.",
      };
    }

    const requiredBalance = (data.qty * data.limitPrice) / data.leverage;

    let positionsBalanceTaken = 0;

    for (const [price, priceLevel] of this.buyOrders.entries()) {
      for (let i = priceLevel.head; i < priceLevel.orders.length; i++) {
        const order = priceLevel.orders[i];

        if (order?.accId === data.accId) {
          positionsBalanceTaken +=
            (order.qty * order.limitPrice) / order.leverage;
        }
      }
    }

    for (const [price, priceLevel] of this.sellOrders.entries()) {
      for (let i = priceLevel.head; i < priceLevel.orders.length; i++) {
        const order = priceLevel.orders[i];

        if (order?.accId === data.accId) {
          positionsBalanceTaken +=
            (order.qty * order.limitPrice) / order.leverage;
        }
      }
    }

    if (account.balance - positionsBalanceTaken < requiredBalance) {
      return {
        success: false,
        message: "Insufficient Balance",
      };
    }

    return { success: true };
  }

  private openLongPositionInAccount(data: Order, executionPrice: Price): void {
    this.accounts.addPosition(
      data.accId,
      {
        orderId: data.orderId,
        side: "LONG",
        qty: data.qty,
        entryPrice: executionPrice,
        limitPrice: data.limitPrice,
        ...(data.takeProfit !== undefined
          ? { takeProfit: data.takeProfit }
          : {}),
        ...(data.stopLoss !== undefined ? { stopLoss: data.stopLoss } : {}),
      },
      "PERPS",
    );
  }

  private openShortPositionInAccount(data: Order, executionPrice: Price): void {
    this.accounts.addPosition(
      data.accId,
      {
        orderId: data.orderId,
        side: "SHORT",
        qty: data.qty,
        entryPrice: executionPrice,
        limitPrice: data.limitPrice,
        ...(data.takeProfit !== undefined
          ? { takeProfit: data.takeProfit }
          : {}),
        ...(data.stopLoss !== undefined ? { stopLoss: data.stopLoss } : {}),
      },
      "PERPS",
    );
  }

  private closeLongPositionInAccount(data: Order): void {
    const positions = this.accounts.getPositions(data.accId, "PERPS");

    if (!positions || data.positionId === undefined) return;

    const position = Array.from(positions).find(
      (position) =>
        position.side === "LONG" && position.orderId === data.positionId,
    );

    if (!position) return;

    const filledQty = Math.min(position.qty, data.qty);

    this.accounts.removePosition(data.accId, position, "PERPS");

    if (position.qty > filledQty) {
      this.accounts.addPosition(
        data.accId,
        {
          ...position,
          qty: position.qty - filledQty,
        },
        "PERPS",
      );
    }
  }

  private closeShortPositionInAccount(data: Order): void {
    const positions = this.accounts.getPositions(data.accId, "PERPS");

    if (!positions || data.positionId === undefined) return;

    const position = Array.from(positions).find(
      (position) =>
        position.side === "SHORT" && position.orderId === data.positionId,
    );

    if (!position) return;

    const filledQty = Math.min(position.qty, data.qty);

    this.accounts.removePosition(data.accId, position, "PERPS");

    if (position.qty > filledQty) {
      this.accounts.addPosition(
        data.accId,
        {
          ...position,
          qty: position.qty - filledQty,
        },
        "PERPS",
      );
    }
  }

  // ADDING ORDER IN TREE WHICH DON'T MATCH INSTANTLY.
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

  // CLEAN-UP LEVEL && REMOVE THE EXCESIVE ORDERS WHICH ARE MATCHED.
  private removeFilledOrder(
    tree: InstanceType<typeof BTree>,
    price: Price,
    level: PriceLevel,
  ): void {
    if (level.head >= level.orders.length) {
      tree.delete(price);
      return;
    }

    if (level.head >= 64 && level.head * 2 >= level.orders.length) {
      level.orders = level.orders.slice(level.head);
      level.head = 0;
    }

    tree.set(price, level);
  }

  // WILL REMOVE ALL THE ORDERS FROM TREE FOR AN SPECIFIC ACCOUNT-ID.
  private liquidateOrdersFromTree(
    tree: InstanceType<typeof BTree>,
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
