export type PsuMode = "user" | "system";
export type Direction = "A" | "B";
export type CardDirection = Direction | "N";

export interface PageOptions {
  page?: number;
  pageSize?: number;
}

export interface TransactionQuery extends PageOptions {
  accountRef: string;
  from: string;
  to: string;
  mode?: PsuMode;
  direction?: Direction;
  minAmount?: number;
  maxAmount?: number;
}

export interface CardTransactionQuery extends PageOptions {
  cardRef: string;
  period: number;
  statementCurrency?: "TRY" | "USD" | "EUR" | "GBP";
  direction?: CardDirection;
  mode?: PsuMode;
}

export interface BankProvider {
  readonly name: string;
  readonly specVersion: string;
  status(): Record<string, unknown>;
  testConnection(): Promise<unknown>;
  listAccounts(options?: PageOptions): Promise<unknown>;
  getBalances(options?: PageOptions): Promise<unknown>;
  listTransactions(query: TransactionQuery): Promise<unknown>;
}

export interface NormalizedTransaction {
  id?: string;
  reference?: string;
  accountRef?: string;
  amount: number;
  currency: string;
  direction: Direction;
  occurredAt?: string;
  description?: string;
  counterparty?: string;
  balanceAfter?: number;
  raw: unknown;
}

export interface NormalizedCardTransaction {
  id?: string;
  cardRef?: string;
  amount: number;
  currency: string;
  direction: CardDirection;
  occurredAt?: string;
  description?: string;
  raw: unknown;
}
