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
    } else {
      that.sellOrders.push(data);
    }
  }

  fillOrder(data: BuyOrders | SellOrders) {
    const that = this;

    let filledOrder: FilledOrder[] = [];

    if (data.side === "BUY") {
      that.sellOrders.sort(
        (a: SellOrders, b: SellOrders) => b.limitPrice - a.limitPrice,
      );
      for (let i = 0; i < that.sellOrders.length; i++) {
        const sellOrder = that.sellOrders[i];
        if (!sellOrder) {
          return { message: "There is no sell orders." };
        }
        if (sellOrder.accId === data.accId) {
          continue;
        }
        if (sellOrder.limitPrice > data.limitPrice) {
          if (filledOrder.length !== 0) {
            return { message: "Order filled", filledOrder };
          } else {
            return { message: "Limit Price is not matching." };
          }
        }
        if (sellOrder.qty > data.qty) {
          sellOrder.qty - data.qty;
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
    } else {
      that.buyOrders.sort(
        (a: BuyOrders, b: BuyOrders) => a.limitPrice - b.limitPrice,
      );
      for (let i = 0; i < that.buyOrders.length; i++) {
        const buyOrder = that.buyOrders[i];
        if (!buyOrder) {
          return { message: "There is no sell orders." };
        }
        if (buyOrder.accId === data.accId) {
          continue;
        }
        if (buyOrder.limitPrice > data.limitPrice) {
          if (filledOrder.length !== 0) {
            return { message: "Order filled", filledOrder };
          } else {
            return { message: "Limit Price is not matching." };
          }
        }
        if (buyOrder.qty > data.qty) {
          buyOrder.qty - data.qty;
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
    }
  }

  liquidateOrders(accId: number) {
    const that = this;
    that.buyOrders = that.buyOrders.filter((order) => order.accId !== accId);
    that.sellOrders = that.sellOrders.filter((order) => order.accId !== accId);
  }

  getDepth() {
    const depthMap = new Map<LimitPrice, CumulativeQuantity>();
    const that = this;
    that.buyOrders.forEach((order) => {
        const cumulativeQty:number = depthMap.get(order.limitPrice) || 0;
        depthMap.set(order.limitPrice, cumulativeQty + order.qty);
    });
    that.sellOrders.forEach((order) => {
        const cumulativeQty:number = depthMap.get(order.limitPrice) || 0;
        depthMap.set(order.limitPrice, cumulativeQty + order.qty);
    });
  }
}
