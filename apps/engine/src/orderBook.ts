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

type FilledOrder = BuyOrders | SellOrders;

type LimitPrice = number;
type CumulativeQuantity = number;

export class OrderBook {
  buyOrders: BuyOrders[];
  sellOrders: SellOrders[];

  constructor() {
    this.buyOrders = [];
    this.sellOrders = [];
  }

  addOrder(data: BuyOrders | SellOrders) {
    const that = this;

    if (data.side === "BUY") {
      that.buyOrders.push(data);
      return { orderId: data.orderId };
    } else {
      that.sellOrders.push(data);
      return { orderId: data.orderId };
    }
  }

  fillOrder(data: BuyOrders | SellOrders) {
    const that = this;

    let filledOrder: FilledOrder[] = [];

    if (data.side === "BUY") {
      that.sellOrders.sort(
        (a: SellOrders, b: SellOrders) => a.limitPrice - b.limitPrice,
      );
      while (that.sellOrders.length > 0) {
        const sellOrder = that.sellOrders[0];
        if (!sellOrder) {
          break;
        }
        if (sellOrder.accId === data.accId) {
          continue;
        }
        if (sellOrder.limitPrice > data.limitPrice) {
          break;
        }
        if (sellOrder.qty > data.qty) {
          sellOrder.qty -= data.qty;
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
        } else if (sellOrder.qty < data.qty) {
          filledOrder = [sellOrder];
          that.sellOrders.shift();
        } else {
          filledOrder = [sellOrder, data];
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
        if (buyOrder.accId === data.accId) {
          continue;
        }
        if (buyOrder.limitPrice > data.limitPrice) {
          break;
        }
        if (buyOrder.qty > data.qty) {
          buyOrder.qty -= data.qty;
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
        } else if (buyOrder.qty < data.qty) {
          filledOrder = [buyOrder];
          that.sellOrders.shift();
        } else {
          filledOrder = [buyOrder, data];
          that.sellOrders.shift();
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
