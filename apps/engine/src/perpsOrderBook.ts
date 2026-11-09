import * as sortedBTree from "sorted-btree";
import {
  Accounts,
  type AccId,
  type Position,
  type PositionId,
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

type CancelOrderResult =
  | { success: true; message: "ORDER_CANCELLED" }
  | {
      success: false;
      message: "ORDER_NOT_FOUND" | "ORDER_ALREADY_FILLED";
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

  fillOrder(data: Order): FillOrderResult {
    const isClosingOrder =
      (data.side === "SELL" && data.direction === "LONG") ||
      (data.side === "BUY" && data.direction === "SHORT");

    if (isClosingOrder) {
      const closeValidation = this.validateCloseOrder(data);

      if (!closeValidation.success) {
        return closeValidation;
      }
    } else {
      const balanceResult = this.hasBalance(data);

      if (!balanceResult.success) {
        return balanceResult;
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

      if (incomingOrder.side === "BUY" && incomingOrder.direction === "LONG") {
        if (incomingOrder.limitPrice < Number(bestPrice)) {
          break;
        }
      } else if (
        incomingOrder.side === "BUY" &&
        incomingOrder.direction === "LONG"
      ) {
        if (incomingOrder.limitPrice > Number(bestPrice)) {
          break;
        }
      }

      if (incomingOrder.accId === bestMatchOrder.accId) {
        return {
          message: "SELF_TRADE_PREVENTED",
          filledOrder,
          remainingQty: incomingOrder.qty,
        };
      }

      const matchedQty = Math.min(incomingOrder.qty, bestMatchOrder.qty);

      this.currentPrice = Number(bestPrice) || this.currentPrice;

      this.accounts.updatePositionsUnRealizedProfitAfterOrderFill(
        this.market,
        this.currentPrice,
      );

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

      const buyerCloseValidation = this.validateCloseOrder(buyerFill);
      if (!buyerCloseValidation.success) {
        return buyerCloseValidation;
      }

      const sellerCloseValidation = this.validateCloseOrder(sellerFill);
      if (!sellerCloseValidation.success) {
        return sellerCloseValidation;
      }

      if (buyerFill.direction === "LONG") {
        this.openLongPositionInAccount(buyerFill, bestPrice);
      } else {
        const closeResult = this.closeShortPositionInAccount(
          buyerFill,
          this.currentPrice,
        );
        if (!closeResult.success) return closeResult;
      }

      if (sellerFill.direction === "LONG") {
        const closeResult = this.closeLongPositionInAccount(
          sellerFill,
          this.currentPrice,
        );
        if (!closeResult.success) return closeResult;
      } else {
        this.openShortPositionInAccount(sellerFill, bestPrice);
      }

      filledOrder.push(buyerFill, sellerFill);

      incomingOrder.qty -= matchedQty;
      bestMatchOrder.qty -= matchedQty;
      priceLevel.totalQty -= matchedQty;

      if (bestMatchOrder.qty === 0) {
        priceLevel.head++;
      }

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

        if (stopLossTriggered && position.stopLoss !== undefined) {
          triggeredPositions.push({
            accId,
            position,
            trigger: "STOP_LOSS",
            triggerPrice: position.stopLoss,
          });
        } else if (takeProfitTriggered && position.takeProfit !== undefined) {
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

  modifyOrderInTreeAndAccount(
    accId: AccId,
    positionId: PositionId,
    tp?: Price,
    sl?: Price,
  ): boolean {
    const trees = [this.buyOrders, this.sellOrders];
    let found = false;

    for (const tree of trees) {
      for (const [price, level] of Array.from(tree.entries())) {
        for (let i = level.head; i < level.orders.length; i++) {
          const order = level.orders[i];

          if (order.accId !== accId || order.positionId !== positionId) {
            continue;
          }

          if (tp !== undefined) order.takeProfit = tp;
          if (sl !== undefined) order.stopLoss = sl;

          tree.set(price, level);
          found = true;
        }
      }
    }

    const position = this.accounts.getPosition(accId, "PERPS", positionId);

    if (position && position.market === this.market) {
      this.accounts.updatePosition(accId, positionId, tp, sl);
      found = true;
    }

    return found;
  }

  cancelUnFilledOrderFromTree(
    accId: AccId,
    orderId: OrderId,
    positionId?: PositionId,
  ): CancelOrderResult {
    const trees = [this.buyOrders, this.sellOrders];

    for (const tree of trees) {
      for (const [price, level] of Array.from(tree.entries())) {
        for (let i = level.head; i < level.orders.length; i++) {
          const order = level.orders[i];

          if (order.accId !== accId || order.orderId !== orderId) {
            continue;
          }

          level.totalQty -= order.qty;
          level.orders.splice(i, 1);

          this.removeFilledOrder(tree, price, level);

          return {
            success: true,
            message: "ORDER_CANCELLED",
          };
        }
      }
    }

    const targetPositionId = positionId ?? `${this.market}:${orderId}`;

    const position = this.accounts.getPosition(
      accId,
      "PERPS",
      targetPositionId,
    );

    if (position && position.market === this.market) {
      return {
        success: false,
        message: "ORDER_ALREADY_FILLED",
      };
    }

    return {
      success: false,
      message: "ORDER_NOT_FOUND",
    };
  }

  //---------------------------
  // HEALPER METHODS
  //---------------------------

  private hasBalance(data: Order): BalanceResult {
    const account = this.accounts.get(data.accId);

    if (!account) {
      return {
        success: false,
        message: "Account not found.",
      };
    }

    const requiredMargin = (data.qty * data.limitPrice) / data.leverage;

    if (account.availableMargin < requiredMargin) {
      return {
        success: false,
        message: "Insufficient available margin.",
      };
    }

    return { success: true };
  }

  private validateCloseOrder(data: Order): BalanceResult {
    const isClosingOrder =
      (data.side === "SELL" && data.direction === "LONG") ||
      (data.side === "BUY" && data.direction === "SHORT");

    if (!isClosingOrder) {
      return { success: true };
    }

    if (data.positionId === undefined) {
      return {
        success: false,
        message: "Position ID is required to close a position.",
      };
    }

    const position = this.accounts.getPosition(
      data.accId,
      "PERPS",
      data.positionId,
    );

    const expectedSide = data.direction;

    if (!position || position.side !== expectedSide) {
      return {
        success: false,
        message: `${expectedSide} position not found.`,
      };
    }

    if (data.qty <= 0 || data.qty > position.qty) {
      return {
        success: false,
        message: "Invalid closing quantity.",
      };
    }

    return { success: true };
  }

  private openLongPositionInAccount(data: Order, executionPrice: Price): void {
    const position: Position = {
      positionId: data.positionId,
      market: this.market,
      side: "LONG",
      qty: data.qty,
      entryPrice: executionPrice,
      leverage: data.leverage,
      margin: (data.qty * executionPrice) / data.leverage,
      unrealizedPnl: 0,
      liquidationPrice: 0,
      ...(data.takeProfit !== undefined ? { takeProfit: data.takeProfit } : {}),
      ...(data.stopLoss !== undefined ? { stopLoss: data.stopLoss } : {}),
    };

    this.accounts.addPosition(data.accId, position, "PERPS");
  }

  private openShortPositionInAccount(data: Order, executionPrice: Price): void {
    const position: Position = {
      positionId: data.positionId,
      market: this.market,
      side: "SHORT",
      qty: data.qty,
      entryPrice: executionPrice,
      leverage: data.leverage,
      margin: (data.qty * executionPrice) / data.leverage,
      unrealizedPnl: 0,
      liquidationPrice: 0,
      ...(data.takeProfit !== undefined ? { takeProfit: data.takeProfit } : {}),
      ...(data.stopLoss !== undefined ? { stopLoss: data.stopLoss } : {}),
    };

    this.accounts.addPosition(data.accId, position, "PERPS");
  }

  private closeLongPositionInAccount(
    data: Order,
    closingPrice: Price,
  ): BalanceResult {
    if (data.positionId === undefined) {
      return {
        success: false,
        message: "Position ID is required.",
      };
    }

    const position = this.accounts.getPosition(
      data.accId,
      "PERPS",
      data.positionId,
    );

    if (!position || position.side !== "LONG") {
      return {
        success: false,
        message: "LONG position not found.",
      };
    }

    if (data.qty <= 0 || data.qty > position.qty) {
      return {
        success: false,
        message: "Invalid closing quantity.",
      };
    }

    const remainingQty = position.qty - data.qty;

    if (remainingQty === 0) {
      this.accounts.removePosition(
        data.accId,
        position.positionId,
        "PERPS",
        closingPrice,
      );
      return { success: true };
    }

    const remainingMargin = position.margin * (remainingQty / position.qty);

    this.accounts.addPosition(
      data.accId,
      {
        ...position,
        qty: remainingQty,
        margin: remainingMargin,
      },
      "PERPS",
    );

    return { success: true };
  }

  private closeShortPositionInAccount(
    data: Order,
    closingPrice: Price,
  ): BalanceResult {
    if (data.positionId === undefined) {
      return {
        success: false,
        message: "Position ID is required.",
      };
    }

    const position = this.accounts.getPosition(
      data.accId,
      "PERPS",
      data.positionId,
    );

    if (!position || position.side !== "SHORT") {
      return {
        success: false,
        message: "SHORT position not found.",
      };
    }

    if (data.qty <= 0 || data.qty > position.qty) {
      return {
        success: false,
        message: "Invalid closing quantity.",
      };
    }

    const remainingQty = position.qty - data.qty;

    if (remainingQty === 0) {
      this.accounts.removePosition(
        data.accId,
        position.positionId,
        "PERPS",
        closingPrice,
      );
      return { success: true };
    }

    const remainingMargin = position.margin * (remainingQty / position.qty);

    this.accounts.addPosition(
      data.accId,
      {
        ...position,
        qty: remainingQty,
        margin: remainingMargin,
      },
      "PERPS",
    );

    return { success: true };
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
