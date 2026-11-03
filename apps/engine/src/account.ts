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
  margin: UsedMargin;
  unrealizedPnl: number;
  liquidationPrice: LiqPrice;
  takeProfit?: Price;
  stopLoss?: Price;
};

export type Account = {
  balance: QuoteBalance;
  equity: Equity;
  usedMargin: UsedMargin;
  availableMargin: AvailableMargin;
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

  entries(): IterableIterator<[AccId, Account]> {
    return this.accounts.entries();
  }

  addBalance(accId: AccId, amount: QuoteBalance): void {
    this.updateBalance(accId, amount);
  }

  updateBalance(accId: AccId, amount: QuoteBalance): void {
    const account = this.ensure(accId);

    account.balance += amount;
    account.equity += amount;
    account.availableMargin = account.equity - account.usedMargin;
  }

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

    const existingPosition = positions.get(position.positionId);

    if (existingPosition) {
      account.usedMargin -= existingPosition.margin;
    }

    positions.set(position.positionId, position);

    account.usedMargin += position.margin;
    account.availableMargin = account.equity - account.usedMargin;
  }

  removePosition(
    accId: AccId,
    positionId: PositionId,
    market: MarketType,
  ): void {
    const account = this.get(accId);
    if (!account) return;

    const positions = account.positions.get(market);
    if (!positions) return;

    const position = positions.get(positionId);
    if (!position) return;

    account.usedMargin -= position.margin;
    positions.delete(positionId);

    account.availableMargin = account.equity - account.usedMargin;
  }
}
