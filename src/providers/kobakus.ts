import { readFile } from "node:fs/promises";
import { appConfig, validateLiveConfig } from "../config.js";
import { TimedCache } from "../lib/cache.js";
import { asRecord, numberValue, stringValue } from "../lib/json.js";
import type {
  BankProvider,
  CardTransactionQuery,
  Direction,
  NormalizedTransaction,
  PageOptions,
  TransactionQuery
} from "../types.js";

const CACHE_TTL = {
  accounts: 5 * 60 * 1000,
  transactions: 5 * 60 * 1000
} as const;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;
const DEFAULT_CHUNK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DEFAULT_ROWS = 1000;

type JsonRecord = Record<string, unknown>;

export interface KobakusAccount {
  accountRef: string;
  bankCode?: string;
  bankName?: string;
  localAccount?: string;
  iban?: string;
  balance?: number;
  availableBalance?: number;
  blocked?: number;
  currency?: string;
  accountType?: string;
  branch?: string;
  branchNo?: string;
  updated?: string;
}

export class KobakusError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMilliseconds?: number
  ) {
    super(message);
    this.name = "KobakusError";
  }
}

function firstString(record: JsonRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function firstNumber(record: JsonRecord, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = numberValue(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function rowsFromPayload(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => {
      const row = asRecord(item);
      return row ? [row] : [];
    });
  }

  const root = asRecord(payload);
  if (!root) return [];

  const result = root.result;
  if (!Array.isArray(result)) return [];

  return result.flatMap((item) => {
    const row = asRecord(item);
    return row ? [row] : [];
  });
}

function assertKobakusSuccess(payload: unknown): void {
  const root = asRecord(payload);
  if (!root) return;

  if (root.success === false) {
    const message = firstString(root, ["msg", "message", "error"]) ?? "Kobaküs request failed";
    throw new KobakusError(message);
  }

  const msg = stringValue(root.msg);
  if (msg && msg.toUpperCase() !== "OK") {
    throw new KobakusError(msg);
  }
}

function normalizeAccount(row: JsonRecord): KobakusAccount {
  const iban = firstString(row, ["Iban", "IBAN", "iban"]);
  const localAccount = firstString(row, ["LocalAccount", "localAccount", "AccountNumber", "AccountNo"]);
  const accountRef = iban ?? localAccount;

  if (!accountRef) {
    throw new KobakusError(
      `Kobaküs account response is missing Iban/LocalAccount. Available fields: ${Object.keys(row).sort().join(", ")}`
    );
  }

  return {
    accountRef,
    bankCode: firstString(row, ["BankCode", "bankCode"]),
    bankName: firstString(row, ["BankName", "bankName"]),
    localAccount,
    iban,
    balance: firstNumber(row, ["Balance", "balance"]),
    availableBalance: firstNumber(row, ["AvailableBalance", "availableBalance"]),
    blocked: firstNumber(row, ["Blocked", "blocked"]),
    currency: firstString(row, ["Currency", "currency"]),
    accountType: firstString(row, ["AccountType", "accountType"]),
    branch: firstString(row, ["Branch", "branch"]),
    branchNo: firstString(row, ["BranchNo", "branchNo"]),
    updated: firstString(row, ["Updated", "updated"])
  };
}

function rowAccountRef(row: JsonRecord): string | undefined {
  return firstString(row, [
    "Iban",
    "IBAN",
    "iban",
    "LocalAccount",
    "localAccount",
    "AccountNumber",
    "AccountNo",
    "BankAccountNo",
    "accountRef"
  ]);
}

function rowMatchesAccount(row: JsonRecord, account: KobakusAccount): boolean {
  const rowRef = rowAccountRef(row);
  if (!rowRef) return false;

  const refs = new Set(
    [account.accountRef, account.iban, account.localAccount]
      .filter((value): value is string => Boolean(value))
  );

  return refs.has(rowRef);
}

function normalizeDirection(value: unknown): Direction | undefined {
  if (typeof value !== "string") return undefined;

  const clean = value.trim().toLocaleUpperCase("tr-TR");

  if (["A", "C", "CREDIT", "ALACAK", "GELEN", "IN", "INCOMING", "+"].includes(clean)) return "A";
  if (["B", "D", "DEBIT", "BORÇ", "BORC", "GİDEN", "GIDEN", "OUT", "OUTGOING", "-"].includes(clean)) return "B";

  return undefined;
}

function inferDirection(row: JsonRecord): Direction | undefined {
  const direct = firstString(row, [
    "Direction",
    "direction",
    "TxnDirection",
    "TxnDebitCredit",
    "CreditDebit",
    "TransactionDirection",
    "DebitCredit",
    "BorcAlacak",
    "BrcAlc",
    "Type",
    "TransactionType"
  ]);

  const normalized = normalizeDirection(direct);
  if (normalized) return normalized;

  const credit = firstNumber(row, ["Credit", "CreditAmount", "credit", "creditAmount", "Alacak", "AlacakTutari"]);
  if (credit !== undefined && credit > 0) return "A";

  const debit = firstNumber(row, ["Debit", "DebitAmount", "debit", "debitAmount", "Borc", "BorcTutari"]);
  if (debit !== undefined && debit > 0) return "B";

  const description = firstString(row, [
    "Description",
    "TxnDescription",
    "TransactionDescription",
    "Explanation",
    "Aciklama",
    "IslemAciklamasi"
  ])?.toLocaleUpperCase("tr-TR");

  if (description) {
    if (/\b(GELEN|ALACAK|CREDIT|INCOMING)\b/.test(description)) return "A";
    if (/\b(GİDEN|GIDEN|BORÇ|BORC|DEBIT|OUTGOING)\b/.test(description)) return "B";
  }

  return undefined;
}

function transactionAmount(row: JsonRecord): { amount?: number; direction?: Direction } {
  const credit = firstNumber(row, ["Credit", "CreditAmount", "credit", "creditAmount", "Alacak", "AlacakTutari"]);
  if (credit !== undefined && credit !== 0) return { amount: Math.abs(credit), direction: "A" };

  const debit = firstNumber(row, ["Debit", "DebitAmount", "debit", "debitAmount", "Borc", "BorcTutari"]);
  if (debit !== undefined && debit !== 0) return { amount: Math.abs(debit), direction: "B" };

  const direct = firstNumber(row, [
    "Amount",
    "amount",
    "TxnAmount",
    "TransactionAmount",
    "TransactionValue",
    "Tutar",
    "IslemTutari"
  ]);

  if (direct === undefined) return {};

  if (direct < 0) return { amount: Math.abs(direct), direction: "B" };
  return { amount: direct };
}

function normalizeTransactionRow(
  row: JsonRecord,
  accountRef: string,
  fallbackCurrency?: string
): NormalizedTransaction {
  const amountInfo = transactionAmount(row);
  const direction = amountInfo.direction ?? inferDirection(row);
  const currency = firstString(row, [
    "Currency",
    "currency",
    "TxnCurrency",
    "TransactionCurrency",
    "TxnCurrencyCode",
    "CurrencyCode",
    "ParaBirimi"
  ]) ?? fallbackCurrency;

  if (amountInfo.amount === undefined || !direction || !currency) {
    throw new KobakusError(
      `Kobaküs transaction response could not be normalized safely. Available fields: ${Object.keys(row).sort().join(", ")}`
    );
  }

  return {
    id: firstString(row, ["TxnId", "TxnID", "TransactionId", "TransactionID", "Id", "ID"]),
    reference: firstString(row, ["Reference", "ReferenceNo", "RefNo", "BankReference", "TransactionReference"]),
    accountRef,
    amount: amountInfo.amount,
    currency,
    direction,
    occurredAt: firstString(row, [
      "TxnDate",
      "TxnValueDate",
      "TransactionDate",
      "ValueDate",
      "Date",
      "TxnTime",
      "TransactionTime",
      "ProcessDate",
      "IslemTarihi",
      "TxnUpdateTime"
    ]),
    description: firstString(row, [
      "Description",
      "TxnDescription",
      "TransactionDescription",
      "Explanation",
      "Aciklama",
      "IslemAciklamasi",
      "Narrative"
    ]),
    counterparty: firstString(row, [
      "Counterparty",
      "CounterParty",
      "SenderReceiver",
      "OtherParty",
      "KarsiTaraf",
      "MerchantName"
    ]),
    balanceAfter: firstNumber(row, [
      "BalanceAfter",
      "Balance",
      "RunningBalance",
      "CurrentBalance",
      "TxnBalance",
      "GnclBky"
    ]),
    raw: row
  };
}

function parseInstant(value: string): number {
  const clean = value.trim();
  if (!clean) throw new Error("from/to cannot be empty");

  const withOffset = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}$/.test(clean)
    ? `${clean.replace(" ", "T")}+03:00`
    : clean;

  const parsed = Date.parse(withOffset);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid date-time: ${value}`);
  return parsed;
}

function formatKobakusDateTime(timestamp: number): string {
  return new Date(timestamp + ISTANBUL_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

export function kobakusDateChunks(from: string, to: string): Array<{ startDate: string; endDate: string }> {
  const start = parseInstant(from);
  const end = parseInstant(to);

  if (end < start) throw new Error("to must be equal to or later than from");

  const chunks: Array<{ startDate: string; endDate: string }> = [];
  let cursor = start;

  while (cursor <= end) {
    const chunkEnd = Math.min(end, cursor + DEFAULT_CHUNK_MS - 1000);
    chunks.push({
      startDate: formatKobakusDateTime(cursor),
      endDate: formatKobakusDateTime(chunkEnd)
    });
    cursor = chunkEnd + 1000;
  }

  return chunks;
}

function retryAfterMs(headers: Headers): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) return undefined;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);

  const date = Date.parse(retryAfter);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());

  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readPassword(): Promise<string> {
  if (appConfig.kobakus.passwordFile) {
    try {
      const value = (await readFile(appConfig.kobakus.passwordFile, "utf8")).trim();
      if (!value) throw new Error("file is empty");
      return value;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new KobakusError(`KOBAKUS_PASSWORD_FILE could not be read: ${detail}`);
    }
  }

  const value = appConfig.kobakus.password.trim();
  if (!value) throw new KobakusError("KOBAKUS_PASSWORD is not configured");
  return value;
}

function localPage<T>(items: T[], options: PageOptions): T[] {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? (items.length || 1);
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export class KobakusProvider implements BankProvider {
  readonly name = "kobakus";
  readonly specVersion = "KWAP";

  private readonly cache = new TimedCache(appConfig.cacheFile);

  status() {
    const problems = validateLiveConfig();

    return {
      provider: this.name,
      specVersion: this.specVersion,
      live: true,
      readOnly: true,
      configured: problems.length === 0,
      problems,
      endpoint: appConfig.kobakus.endpoint,
      capabilities: {
        accounts: true,
        balances: true,
        transactions: true,
        cards: false,
        cardTransactions: false,
        payments: false
      },
      credentials: {
        firmCodeConfigured: Boolean(appConfig.kobakus.firmCode.trim()),
        channelCodeConfigured: Boolean(appConfig.kobakus.channelCode.trim()),
        passwordConfigured: Boolean(appConfig.kobakus.password.trim() || appConfig.kobakus.passwordFile),
        passwordFileConfigured: Boolean(appConfig.kobakus.passwordFile)
      },
      cache: {
        ...this.cache.stats(),
        accountTtlSeconds: CACHE_TTL.accounts / 1000,
        transactionTtlSeconds: CACHE_TTL.transactions / 1000
      }
    };
  }

  async listAccounts(options: PageOptions = {}) {
    const accounts = await this.accounts();
    const page = localPage(accounts, options);

    return {
      provider: this.name,
      count: page.length,
      total: accounts.length,
      accounts: page
    };
  }

  async getBalances(options: PageOptions = {}) {
    const accounts = await this.accounts();
    const balances = accounts.map((account) => ({
      accountRef: account.accountRef,
      bankName: account.bankName,
      iban: account.iban,
      localAccount: account.localAccount,
      balance: account.balance,
      availableBalance: account.availableBalance,
      blocked: account.blocked,
      currency: account.currency,
      updated: account.updated
    }));
    const page = localPage(balances, options);

    return {
      provider: this.name,
      count: page.length,
      total: balances.length,
      balances: page
    };
  }

  async listTransactions(query: TransactionQuery) {
    const accounts = await this.accounts();
    const account = accounts.find((item) => item.accountRef === query.accountRef);

    if (!account) {
      throw new KobakusError(
        `Unknown Kobaküs accountRef: ${query.accountRef}. Call bank_list_accounts and use the returned accountRef.`
      );
    }

    const chunks = kobakusDateChunks(query.from, query.to);
    const rows: JsonRecord[] = [];
    let mayBeTruncated = false;

    for (const chunk of chunks) {
      const cacheKey = `kobakus:transactions:${chunk.startDate}:${chunk.endDate}`;
      const payload = await this.cache.getOrCreate(
        cacheKey,
        CACHE_TTL.transactions,
        () => this.request({
          requestMethod: "Transactions",
          startDate: chunk.startDate,
          endDate: chunk.endDate
        })
      );

      const chunkRows = rowsFromPayload(payload);
      if (chunkRows.length >= MAX_DEFAULT_ROWS) mayBeTruncated = true;
      rows.push(...chunkRows);
    }

    const rowsWithAccount = rows.filter((row) => rowAccountRef(row));
    let selectedRows: JsonRecord[];

    if (rowsWithAccount.length === 0) {
      if (accounts.length !== 1) {
        throw new KobakusError(
          "Kobaküs transaction rows do not expose an account identifier in the public schema and more than one account is connected. Refusing to mix transactions across accounts."
        );
      }
      selectedRows = rows;
    } else {
      selectedRows = rows.filter((row) => rowMatchesAccount(row, account));
    }

    let transactions = selectedRows.map((row) =>
      normalizeTransactionRow(row, account.accountRef, account.currency)
    );

    if (query.direction) transactions = transactions.filter((tx) => tx.direction === query.direction);
    if (query.minAmount !== undefined) transactions = transactions.filter((tx) => tx.amount >= query.minAmount!);
    if (query.maxAmount !== undefined) transactions = transactions.filter((tx) => tx.amount <= query.maxAmount!);

    transactions.sort((a, b) => {
      const left = a.occurredAt ? Date.parse(a.occurredAt) : 0;
      const right = b.occurredAt ? Date.parse(b.occurredAt) : 0;
      return left - right;
    });

    const total = transactions.length;
    const page = localPage(transactions, query);

    return {
      provider: this.name,
      accountRef: query.accountRef,
      from: query.from,
      to: query.to,
      count: page.length,
      total,
      mayBeTruncated,
      warning: mayBeTruncated
        ? "At least one Kobaküs request returned 1000 rows. Use a shorter date range if you need a guaranteed complete feed."
        : undefined,
      transactions: page
    };
  }

  async listCards(_options: PageOptions = {}) {
    throw new KobakusError(
      "The public Kobaküs KWAP contract used by TurkishBankMCP documents Accounts and Transactions only. Card-list tools are available with the direct ÖHVPS provider."
    );
  }

  async listCardTransactions(_query: CardTransactionQuery) {
    throw new KobakusError(
      "The public Kobaküs KWAP contract used by TurkishBankMCP does not document a card-transactions requestMethod. Use account transactions or the direct ÖHVPS provider for card-specific data."
    );
  }

  private async accounts(): Promise<KobakusAccount[]> {
    const payload = await this.cache.getOrCreate(
      "kobakus:accounts",
      CACHE_TTL.accounts,
      () => this.request({ requestMethod: "Accounts" })
    );

    return rowsFromPayload(payload).map(normalizeAccount);
  }

  private async request(extra: Record<string, string>): Promise<unknown> {
    const problems = validateLiveConfig();
    if (problems.length > 0) {
      throw new KobakusError(`Kobaküs provider is not configured: ${problems.join("; ")}`);
    }

    const body = new URLSearchParams({
      firmCode: appConfig.kobakus.firmCode,
      password: await readPassword(),
      channelCode: appConfig.kobakus.channelCode,
      ...extra
    });

    let lastError: unknown;

    for (let attempt = 0; attempt <= appConfig.httpMaxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), appConfig.httpTimeoutMs);

      try {
        const response = await fetch(appConfig.kobakus.endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body,
          signal: controller.signal
        });

        const text = await response.text();
        let payload: unknown = text;

        if (text.trim()) {
          try {
            payload = JSON.parse(text) as unknown;
          } catch {
            payload = text;
          }
        }

        if (response.ok) {
          assertKobakusSuccess(payload);
          return payload;
        }

        const suggestedDelay = retryAfterMs(response.headers);

        if (!RETRYABLE_STATUS.has(response.status) || attempt >= appConfig.httpMaxRetries) {
          throw new KobakusError(
            `Kobaküs request failed with HTTP ${response.status}`,
            response.status,
            suggestedDelay
          );
        }

        const delay = suggestedDelay ?? appConfig.httpRetryBaseMs * (2 ** attempt);

        if (delay > appConfig.httpMaxRetryWaitMs) {
          throw new KobakusError(
            `Kobaküs request is rate-limited or temporarily unavailable. Retry after about ${Math.ceil(delay / 1000)} seconds.`,
            response.status,
            delay
          );
        }

        await sleep(delay);
      } catch (error) {
        if (error instanceof KobakusError) throw error;

        lastError = error;
        const isAbort = error instanceof Error && error.name === "AbortError";

        if (attempt >= appConfig.httpMaxRetries) {
          if (isAbort) {
            throw new KobakusError(`Kobaküs request timed out after ${appConfig.httpTimeoutMs}ms`);
          }
          throw error;
        }

        const delay = Math.min(
          appConfig.httpRetryBaseMs * (2 ** attempt),
          appConfig.httpMaxRetryWaitMs
        );

        await sleep(delay);
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError instanceof Error ? lastError : new KobakusError("Kobaküs request failed");
  }
}
