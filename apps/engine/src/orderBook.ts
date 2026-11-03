import * as sortedBTree from "sorted-btree";
const BTree = sortedBTree.default.default;

type MarketId = string;
type AccId = number;
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

type Position = {
  orderId: OrderId;
  qty: Quantity;
  limitPrice: Price;
  takeProfit?: Price;
  stopLoss?: Price;
};

type Account = {
  // Quote asset balance, e.g. USDT in BTC/USDT.
  balance: QuoteBalance;
  // Acquired base-asset positions.
  positions: Set<Position>;
};

type PriceLevel = {
  // Orders at the same price, in FIFO order.
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

type AddOrderResult =
  | {
      success: true;
      message: string;
      orderId: OrderId;
    }
  | {
      success: false;
      message: string;
    };

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

  buyOrders: BTree<Price, PriceLevel>;
  sellOrders: BTree<Price, PriceLevel>;

  accounts: Map<AccId, Account>;

  constructor(market: MarketId) {
    this.market = market;
    this.currentPrice = 0;

    this.buyOrders = new BTree<Price, PriceLevel>();
    this.sellOrders = new BTree<Price, PriceLevel>();

    this.accounts = new Map<AccId, Account>();
  }

  // -----------------------
  // CORE METHODS
  // -----------------------

  addBalance(data: { accId: AccId; balance: QuoteBalance }): void {
    const account = this.accounts.get(data.accId);

    if (account) {
      account.balance += data.balance;
      return;
    }

    this.accounts.set(data.accId, {
      balance: data.balance,
      positions: new Set<Position>(),
    });
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

      if (incomingOrder.side === "BUY") {
        if (bestMatchOrder.qty > incomingOrder.qty) {
          bestMatchOrder.qty -= incomingOrder.qty;

          filledOrder.push(
            {
              ...bestMatchOrder,
              qty: incomingOrder.qty,
            },
            {
              ...incomingOrder,
            },
          );

          incomingOrder.qty = 0;
        } else if (bestMatchOrder.qty < incomingOrder.qty) {
          incomingOrder.qty -= bestMatchOrder.qty;

          filledOrder.push(
            {
              ...bestMatchOrder,
            },
            {
              ...incomingOrder,
              qty: bestMatchOrder.qty,
            },
          );

          priceLevel.head++;
        } else {
          filledOrder.push(
            {
              ...bestMatchOrder,
            },
            {
              ...incomingOrder,
            },
          );

          incomingOrder.qty = 0;
          priceLevel.head++;
        }
      } else {
        if (bestMatchOrder.qty > incomingOrder.qty) {
          bestMatchOrder.qty -= incomingOrder.qty;

          filledOrder.push(
            {
              ...incomingOrder,
            },
            {
              ...bestMatchOrder,
              qty: incomingOrder.qty,
            },
          );

          incomingOrder.qty = 0;
        } else if (bestMatchOrder.qty < incomingOrder.qty) {
          incomingOrder.qty -= bestMatchOrder.qty;

          filledOrder.push(
            {
              ...incomingOrder,
              qty: bestMatchOrder.qty,
            },
            {
              ...bestMatchOrder,
            },
          );

          priceLevel.head++;
        } else {
          filledOrder.push(
            {
              ...incomingOrder,
            },
            {
              ...bestMatchOrder,
            },
          );

          incomingOrder.qty = 0;
          priceLevel.head++;
        }
      }

      this.removeFilledOrder(oppositeTree, bestPrice, priceLevel);
    }

    if (incomingOrder.qty > 0) {
      if (filledOrder.length > 0) {
        this.addOrderToTree(incomingOrder);

        return {
          message: "PARTIALLY_FILLED",
          filledOrder,
          remainingQty: incomingOrder.qty,
        };
      }

      this.addOrderToTree(incomingOrder);

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

    for (const [accId, account] of this.accounts) {
      for (const position of account.positions) {
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

  cancelOrdersForAccount(accId: AccId): void {
    this.removeAccountOrders(this.buyOrders, accId);
    this.removeAccountOrders(this.sellOrders, accId);
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

  // can u verify that, are we using this as a healper fn any where  ? if not then remove it bcz the order is going to tree via fill order fn only.
  addOrder(data: Order): AddOrderResult {
    const balanceResult = this.hasBalance(data);

    if (!balanceResult.success) {
      return balanceResult;
    }

    this.addOrderToTree(data);

    return {
      success: true,
      message: "Added order successfully.",
      orderId: data.orderId,
    };
  }

  // --------------------------------
  // HEALPER METHODS
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
      let openBuyValue = 0;

      // Calculate quote balance committed to existing BUY orders.
      for (const [, level] of this.buyOrders.entries()) {
        for (let i = level.head; i < level.orders.length; i++) {
          const order = level.orders[i];

          if (order?.accId === data.accId) {
            openBuyValue += order.qty * order.limitPrice;
          }
        }
      }

      if (account.balance - openBuyValue < requiredBalance) {
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
    const account = this.accounts.get(accId);

    if (!account) {
      return 0;
    }

    let positionQty = 0;
    let openSellQty = 0;

    for (const position of account.positions) {
      positionQty += position.qty;
    }

    // Subtract base quantity committed to existing SELL orders.
    for (const [, level] of this.sellOrders.entries()) {
      for (let i = level.head; i < level.orders.length; i++) {
        const order = level.orders[i];

        if (order?.accId === accId) {
          openSellQty += order.qty;
        }
      }
    }

    return positionQty - openSellQty;
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

  private addOrderInAccount(data: Order): void {
    const account = this.accounts.get(data.accId);

    if (!account) {
      return;
    }

    if (data.side === "BUY") {
      account.balance -= data.qty * data.limitPrice;

      account.positions.add({
        orderId: data.orderId,
        qty: data.qty,
        limitPrice: data.limitPrice,
        ...(data.takeProfit !== undefined
          ? { takeProfit: data.takeProfit }
          : {}),
        ...(data.stopLoss !== undefined ? { stopLoss: data.stopLoss } : {}),
      });

      return;
    }

    account.balance += data.qty * data.limitPrice;

    let remainingQty = data.qty;
    const positions = Array.from(account.positions);

    for (const position of positions) {
      if (remainingQty <= 0) {
        break;
      }

      const filledQty = Math.min(position.qty, remainingQty);

      account.positions.delete(position);

      if (position.qty > filledQty) {
        account.positions.add({
          ...position,
          qty: position.qty - filledQty,
        });
      }

      remainingQty -= filledQty;
    }
  }

  private getBestOrder(
    tree: BTree<Price, PriceLevel>,
    side: "BUY" | "SELL",
  ):
    | {
        price: Price;
        level: PriceLevel;
        order: Order;
      }
    | undefined {
    const price = side === "BUY" ? tree.maxKey() : tree.minKey();

    if (price === undefined) {
      return undefined;
    }

    const level = tree.get(price);

    if (!level) {
      return undefined;
    }

    const order = level.orders[level.head];

    if (!order) {
      return undefined;
    }

    return { price, level, order };
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

  private removeAccountOrders(
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
