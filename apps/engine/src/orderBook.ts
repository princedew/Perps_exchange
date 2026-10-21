type BuyOrders = {
  accId: number;
  orderId: number;
  side: "BUY";
  qty: number;
  limitPrice: number;
  takeProfit: number;
  stopLoss: number;
};

type SellOrders = {
  accId: number;
  orderId: number;
  side: "SELL";
  qty: number;
  limitPrice: number;
  takeProfit: number;
  stopLoss: number;
};

type Order = {
  orderId: number;
  side: "BUY" | "SELL";
  qty: number;
  limitPrice: number;
  takeProfit: number;
  stopLoss: number;
};

type FilledOrder = BuyOrders | SellOrders;

type LimitPrice = number;
type CumulativeQuantity = number;
type AccId = number;

export class OrderBook {
  market: string;
  buyOrders: BuyOrders[];
  sellOrders: SellOrders[];
  accounts: Map<
    AccId,
    { balance: number; marginToMaintain: number; orders: Order[] }
  >;

  constructor(market: string) {
    this.market = market;
    this.buyOrders = [];
    this.sellOrders = [];
    this.accounts = new Map<
      AccId,
      { balance: number; marginToMaintain: number; orders: Order[] }
    >();
  }

  addBalance(data: { accId: number; balance: number }) {
    const that = this;
    const account = that.accounts.get(data.accId) || {
      balance: 0,
      marginToMaintain: 0,
      orders: [],
    };
    account.balance += data.balance;
    that.accounts.set(data.accId, account);
    return data;
  }

  hasMargin(data: BuyOrders | SellOrders) {
    const that = this;
    const account = that.accounts.get(data.accId);
    if (!account) {
      return { success: false, message: "Account not found." };
    }
    const requiredMargin =
      account.marginToMaintain + data.qty * data.limitPrice;
    if (account.balance < requiredMargin) {
      return { success: false, message: "Insufficiant Balance" };
    }
    return { success: true };
  }

  addOrder(data: BuyOrders | SellOrders) {
    const that = this;

    const hasMargin = that.hasMargin(data);
    if (!hasMargin.success) {
      return hasMargin;
    }

    if (data.side === "BUY") {
      that.buyOrders.push(data);
    } else {
      that.sellOrders.push(data);
    }

    const account = that.accounts.get(data.accId);
    if (!account) {
      return { success: false, message: "Account not found." };
    }
    const { accId, ...orderData } = data;
    account.orders.push(orderData);

    return {
      success: true,
      message: "Added order successfully.",
      orderId: data.orderId,
    };
  }

  addOrderInAccount(data: BuyOrders | SellOrders) {
    const that = this;

    const account = that.accounts.get(data.accId);
    if (!account) {
      return;
    }
    const { accId, ...orderData } = data;
    account.orders.push(orderData);
  }

  isOrderInAcc(data: BuyOrders | SellOrders) {
    const that = this;
    let hasOrderInAccount = false;
    that.accounts.get(data.accId)?.orders.forEach((o) => {
      if (o.orderId === data.orderId) {
        hasOrderInAccount = true;
      }
    });
    return hasOrderInAccount;
  }

  fillOrder(data: BuyOrders | SellOrders) {
    console.log("reaching fillOrder() ...");
    
    const that = this;
    
    let filledOrder: FilledOrder[] = [];
    
    const hasMargin = that.hasMargin(data);
    if (!hasMargin.success) {
      return hasMargin;
    }
    console.log("reaching fillOrder() ...");

    if (data.side === "BUY") {
      that.sellOrders.sort(
        (a: SellOrders, b: SellOrders) => a.limitPrice - b.limitPrice,
      );
      while (that.sellOrders.length > 0 || data.qty > 0) {
        console.log("looping....")
        console.log("data.qty :", data.qty)
        const sellOrder = that.sellOrders[0];
        if (!sellOrder) {
          break;
        }
        if (!that.isOrderInAcc(sellOrder)) {
          break;
        }
        if (sellOrder.accId === data.accId) {
          break;
        }
        if (sellOrder.limitPrice > data.limitPrice) {
          break;
        }
        if (sellOrder.qty > data.qty) {
          filledOrder = [
            {
              accId: sellOrder.accId,
              orderId: sellOrder.orderId,
              side: sellOrder.side,
              qty: sellOrder.qty - data.qty,
              limitPrice: sellOrder.limitPrice,
              takeProfit: sellOrder.takeProfit,
              stopLoss: sellOrder.stopLoss,
            },
            data,
          ];
          sellOrder.qty -= data.qty;
          that.addOrderInAccount(data);
          break;
        } else if (sellOrder.qty < data.qty) {
          data.qty -= sellOrder.qty;
          filledOrder = [sellOrder];
          const accData = {
            ...data,
            qty: data.qty,
          };
          that.addOrderInAccount(accData);
          that.sellOrders.shift();
        } else {
          filledOrder = [sellOrder, data];
          that.addOrderInAccount(data);
          that.sellOrders.shift();
        }
      }
      if (filledOrder.length > 0) {
        return { message: "FILLED", filledOrder };
      }
    } else {
      that.buyOrders.sort(
        (a: BuyOrders, b: BuyOrders) => b.limitPrice - a.limitPrice,
      );

      while (that.buyOrders.length > 0) {
        const buyOrder = that.buyOrders[0];

        if (!buyOrder) {
          break;
        }
        if (!that.isOrderInAcc(buyOrder)) {
          break;
        }
        if (buyOrder.accId === data.accId) {
          break;
        }
        if (buyOrder.limitPrice < data.limitPrice) {
          break;
        }
        if (buyOrder.qty > data.qty) {
          filledOrder = [
            {
              accId: buyOrder.accId,
              orderId: buyOrder.orderId,
              side: buyOrder.side,
              qty: buyOrder.qty - data.qty,
              limitPrice: buyOrder.limitPrice,
              takeProfit: buyOrder.takeProfit,
              stopLoss: buyOrder.stopLoss,
            },
            data,
          ];

          buyOrder.qty -= data.qty;
          that.addOrderInAccount(data);
          break;
        } else if (buyOrder.qty < data.qty) {
          data.qty -= buyOrder.qty;
          filledOrder = [buyOrder];

          const accData = {
            ...data,
            qty: data.qty,
          };

          that.addOrderInAccount(accData);
          that.buyOrders.shift();
        } else {
          filledOrder = [buyOrder, data];
          that.addOrderInAccount(data);
          that.buyOrders.shift();
          break;
        }
      }
      if (filledOrder.length > 0) {
        return { message: "FILLED", filledOrder };
      }
    }
  }

  liquidateOrders(accId: number) {
    const that = this;
    that.buyOrders = that.buyOrders.filter((order) => order.accId !== accId);
    that.sellOrders = that.sellOrders.filter((order) => order.accId !== accId);
    const account = that.accounts.get(accId);
    if (account) {
      account.orders = [];
    }
  }

  getDepth() {
    const that = this;
    const buyDepthMap = new Map<LimitPrice, CumulativeQuantity>();
    const sellDepthMap = new Map<LimitPrice, CumulativeQuantity>();
    that.buyOrders.forEach((order) => {
      const cumulativeQty: number = buyDepthMap.get(order.limitPrice) || 0;
      buyDepthMap.set(order.limitPrice, cumulativeQty + order.qty);
    });
    that.sellOrders.forEach((order) => {
      const cumulativeQty: number = sellDepthMap.get(order.limitPrice) || 0;
      sellDepthMap.set(order.limitPrice, cumulativeQty + order.qty);
    });
    return {
      buyDepth: Object.fromEntries(buyDepthMap),
      sellDepth: Object.fromEntries(sellDepthMap),
    };
  }
}
