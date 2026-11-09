export type AccId = number;
export type QuoteBalance = number;
export type Price = number;
export type Quantity = number;
export type OrderId = number;
export type PositionId = string;
export type Equity = number;
export type LiqPrice = number;
export type AvailableMargin = number;
export type UsedMargin = number;
export type Leverage = number;
export type MarketSymbol = string;

export type MarketType = "SPOT" | "PERPS";
export type PositionSide = "LONG" | "SHORT";

export type Position = {
  positionId: PositionId;
  market: MarketSymbol;
  side: PositionSide;
  entryPrice: Price;
  qty: Quantity;
  leverage: Leverage;
  margin: UsedMargin; // [USES]: it is required to calculate used margin.
  unrealizedPnl: number;
  liquidationPrice: LiqPrice; // remove
  takeProfit?: Price;
  stopLoss?: Price;
};

export type Account = {
  balance: QuoteBalance;
  equity: Equity;
  usedMargin: UsedMargin;
  availableMargin: AvailableMargin;
  realizedPnl: 0;
  unrealizedPnl: 0;
  totalProfit: 0;
  positions: Map<MarketType, Map<PositionId, Position>>;
};

export class Accounts {
  private accounts = new Map<AccId, Account>();

  get(accId: AccId): Account | undefined {
    return this.accounts.get(accId);
  }

  ensure(accId: AccId, balance = 0): Account {
    const existing = this.accounts.get(accId);

    if (existing) return existing;

    const account: Account = {
      balance,
      equity: balance,
      usedMargin: 0,
      availableMargin: balance,
      positions: new Map<MarketType, Map<PositionId, Position>>([
        ["SPOT", new Map<PositionId, Position>()],
        ["PERPS", new Map<PositionId, Position>()],
      ]),
    };

    this.accounts.set(accId, account);

    return account;
  }

  entries(): [AccId, Account][] {
    return this.accounts.entries();
  }

  addBalance(accId: AccId, amount: QuoteBalance): void {
    const account = this.ensure(accId);

    account.balance += amount;
    account.equity += amount;
    account.availableMargin += amount;
    // account.availableMargin = account.equity - account.usedMargin;
    // calculateAvailableMargin();
  }

  //   updateUnrealizedPnl(
  //     accId: AccId,
  //     market: MarketType,
  //     positionId: PositionId,
  //     pnl: number,
  //   ): void {
  //     const account = this.get(accId);
  //     if (!account) return;

  //     const positions = account.positions.get(market);
  //     if (!positions) return;

  //     const position = positions.get(positionId);
  //     if (!position) return;

  //     account.unrealizedPnl -= position.unrealizedPnl;

  //     const updatedPosition: Position = {
  //       ...position,
  //       unrealizedPnl: pnl,
  //     };

  //     positions.set(positionId, updatedPosition);

  //     account.unrealizedPnl += pnl;
  //   }

  //   updateRealizedPnl(accId: AccId, pnl: number): void {
  //     const account = this.get(accId);
  //     if (!account) return;

  //     account.realizedPnl += pnl;
  //     account.balance += pnl;
  //   }

  getPositions(
    accId: AccId,
    market: MarketType,
  ): Map<PositionId, Position> | undefined {
    return this.get(accId)?.positions.get(market);
  }

  getPosition(
    accId: AccId,
    market: MarketType,
    positionId: PositionId,
  ): Position | undefined {
    return this.getPositions(accId, market)?.get(positionId);
  }

  addPosition(accId: AccId, position: Position, market: MarketType): void {
    const account = this.ensure(accId);
    const positions = account.positions.get(market);

    if (!positions) return;

    // const existingPosition = positions.get(position.positionId);

    // if (existingPosition) {
    //   account.usedMargin -= existingPosition.margin;
    // }

    positions.set(position.positionId, position);

    account.usedMargin += position.margin;
    account.availableMargin = account.equity - account.usedMargin;
  }

  updatePosition(
    accId: AccId,
    positionId: PositionId,
    tp?: Price,
    sl?: Price,
  ): void {
    const account = this.get(accId);
    if (!account) return;

    const positions = account.positions.get("PERPS");
    if (!positions) return;

    const position = positions.get(positionId);
    if (!position) return;

    positions.set(positionId, {
      ...position,
      ...(tp !== undefined ? { takeProfit: tp } : {}),
      ...(sl !== undefined ? { stopLoss: sl } : {}),
    });
  }

  removePosition(
    accId: AccId,
    positionId: PositionId,
    market: MarketType,
    closingPrice:Price
  ): void {
    const account = this.get(accId);
    if (!account) return;

    const positions = account.positions.get(market);
    if (!positions) return;

    const position = positions.get(positionId);
    if (!position) return;

    account.usedMargin -= position.margin;
    position. (position.entryPrice - closingPrice)
    positions.delete(positionId);

    account.availableMargin = account.equity - account.usedMargin;
  }

  // THIS METHOD WILL UPDATE THE PNL OF POSITIONS AFTER THE CHANGE OF CURRENT-PRICE.
  updatePositionsUnRealizedProfitAfterOrderFill(
    market: string,
    currentPrice: number,
  ) {
    for (const [accId, account] of this.accounts.entries()) {
      const perpsPositions = account.positions.get("PERPS");
      if (!perpsPositions) continue;
      for (const [positionId, position] of perpsPositions?.entries()) {
        if (position.market !== market) continue;
        position.unrealizedPnl =
          position.side === "SHORT"
            ? (position.entryPrice - currentPrice) * position.qty
            : (currentPrice - position.entryPrice) * position.qty;
        account.equity += position.unrealizedPnl;
      }
    }
  }
}
