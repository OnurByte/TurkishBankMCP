import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { appConfig, validateLiveConfig } from "../config.js";
import { TimedCache } from "../lib/cache.js";
import type { BankProvider, CardTransactionQuery, PageOptions, PsuMode, TransactionQuery } from "../types.js";

const CACHE_TTL = {
  accounts: 6 * 60 * 60 * 1000,
  balances: 60 * 60 * 1000,
  transactions: 6 * 60 * 60 * 1000,
  cards: 6 * 60 * 60 * 1000,
  cardTransactions: 45 * 60 * 1000
} as const;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function bearer(value: string): string {
  return /^Bearer\s/i.test(value) ? value : `Bearer ${value}`;
}

function pageParams(options: PageOptions = {}) {
  const params = new URLSearchParams();
  if (options.page !== undefined) params.set("syfNo", String(options.page));
  if (options.pageSize !== undefined) params.set("syfKytSayi", String(Math.min(options.pageSize, 100)));
  return params;
}

export function validateWindow(from: string, to: string, mode: PsuMode) {
  const start = Date.parse(from);
  const end = Date.parse(to);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error("from/to must be valid ISO date-time values");
  }

  if (end < start) throw new Error("to must be equal to or later than from");

  const windowMs = end - start;
  const maxMs = mode === "system"
    ? 24 * 60 * 60 * 1000
    : 31 * 24 * 60 * 60 * 1000;

  if (windowMs > maxMs) {
    throw new Error(
      mode === "system"
        ? "ÖHVPS 2.0.0 system-triggered transaction queries are limited to 24 hours"
        : "ÖHVPS 2.0.0 individual user-triggered transaction queries are limited to one month"
    );
  }
}

function retryAfterMs(headers: Headers): number | undefined {
  const rateReset = headers.get("x-ratelimit-reset");
  if (rateReset) {
    const seconds = Number(rateReset);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  }

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

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") || /^[\[{]/.test(text.trim())) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  return text;
}

function errorDetails(body: unknown, status: number) {
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : undefined;

  const code = typeof record?.errorCode === "string" ? record.errorCode : undefined;
  const detail = typeof record?.moreInformationTr === "string"
    ? record.moreInformationTr
    : typeof record?.moreInformation === "string"
      ? record.moreInformation
      : `HTTP ${status}`;

  return { code, detail };
}

async function readSecret(
  inlineValue: string,
  filePath: string | undefined,
  label: string
): Promise<string> {
  if (filePath) {
    try {
      const value = (await readFile(filePath, "utf8")).trim();
      if (!value) throw new Error("file is empty");
      return value;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${label} could not be read from its configured file: ${detail}`);
    }
  }

  const value = inlineValue.trim();
  if (!value) throw new Error(`${label} is not configured`);
  return value;
}

export class OhvpsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly retryAfterMilliseconds?: number
  ) {
    super(message);
    this.name = "OhvpsError";
  }
}

export class OhvpsProvider implements BankProvider {
  readonly name = "ohvps";
  readonly specVersion = appConfig.specVersion;

  private readonly cache = new TimedCache(appConfig.cacheFile);
  private readonly groupId = appConfig.ohvps.groupId || randomUUID();

  status() {
    const problems = validateLiveConfig();

    return {
      provider: this.name,
      specVersion: this.specVersion,
      live: true,
      readOnly: true,
      configured: problems.length === 0,
      problems,
      cache: {
        ...this.cache.stats(),
        accountTtlSeconds: CACHE_TTL.accounts / 1000,
        balanceTtlSeconds: CACHE_TTL.balances / 1000,
        transactionTtlSeconds: CACHE_TTL.transactions / 1000,
        cardTtlSeconds: CACHE_TTL.cards / 1000,
        cardTransactionTtlSeconds: CACHE_TTL.cardTransactions / 1000
      },
      http: {
        timeoutMs: appConfig.httpTimeoutMs,
        maxRetries: appConfig.httpMaxRetries,
        maxRetryWaitMs: appConfig.httpMaxRetryWaitMs
      },
      credentials: {
        gatewayTokenConfigured: Boolean(appConfig.ohvps.gatewayToken || appConfig.ohvps.gatewayTokenFile),
        gatewayTokenFileConfigured: Boolean(appConfig.ohvps.gatewayTokenFile),
        accessTokenConfigured: Boolean(appConfig.ohvps.accessToken || appConfig.ohvps.accessTokenFile),
        accessTokenFileConfigured: Boolean(appConfig.ohvps.accessTokenFile),
        psuFraudCheckConfigured: Boolean(appConfig.ohvps.psuFraudCheck || appConfig.ohvps.psuFraudCheckFile),
        tppCodePresent: Boolean(appConfig.ohvps.tppCode),
        aspspCodePresent: Boolean(appConfig.ohvps.aspspCode)
      }
    };
  }

  async listAccounts(options: PageOptions = {}) {
    const params = pageParams(options);
    const cacheKey = `accounts:${params.toString()}`;

    return this.cache.getOrCreate(
      cacheKey,
      CACHE_TTL.accounts,
      () => this.request("/hesaplar", params, "system")
    );
  }

  async getBalances(options: PageOptions = {}) {
    const params = pageParams(options);
    const cacheKey = `balances:${params.toString()}`;

    return this.cache.getOrCreate(
      cacheKey,
      CACHE_TTL.balances,
      () => this.request("/bakiye", params, "system")
    );
  }

  async listTransactions(query: TransactionQuery) {
    const mode = query.mode ?? "user";
    validateWindow(query.from, query.to, mode);

    const params = pageParams(query);
    params.set("hesapIslemBslTrh", query.from);
    params.set("hesapIslemBtsTrh", query.to);

    if (query.direction) params.set("brcAlc", query.direction);
    if (query.minAmount !== undefined) params.set("minIslTtr", String(query.minAmount));
    if (query.maxAmount !== undefined) params.set("mksIslTtr", String(query.maxAmount));

    params.set("srlmKrtr", "islGrckZaman");
    params.set("srlmYon", "Y");

    const path = `/hesaplar/${encodeURIComponent(query.accountRef)}/islemler`;
    const cacheKey = `transactions:${path}:${mode}:${params.toString()}`;

    return this.cache.getOrCreate(
      cacheKey,
      CACHE_TTL.transactions,
      () => this.request(path, params, mode)
    );
  }

  async listCards(options: PageOptions = {}) {
    const params = pageParams(options);
    const cacheKey = `cards:${params.toString()}`;

    return this.cache.getOrCreate(
      cacheKey,
      CACHE_TTL.cards,
      () => this.request("/kartlar", params, "system")
    );
  }

  async listCardTransactions(query: CardTransactionQuery) {
    if (!Number.isInteger(query.period) || (query.period !== 99 && (query.period < -12 || query.period > 18))) {
      throw new Error("period must be 99 or an integer from -12 through 18; card type may further restrict accepted periods");
    }

    const mode = query.mode ?? "user";
    const params = pageParams(query);

    params.set("donemDegeri", String(query.period));
    if (query.statementCurrency) params.set("ekstreTuru", query.statementCurrency);
    if (query.direction) params.set("brcAlc", query.direction);
    params.set("srlmYon", "Y");

    const path = `/kartlar/${encodeURIComponent(query.cardRef)}/kart-hareketleri`;
    const cacheKey = `card-transactions:${path}:${mode}:${params.toString()}`;

    return this.cache.getOrCreate(
      cacheKey,
      CACHE_TTL.cardTransactions,
      () => this.request(path, params, mode)
    );
  }

  private async headers(mode: PsuMode): Promise<Record<string, string>> {
    const gatewayToken = await readSecret(
      appConfig.ohvps.gatewayToken,
      appConfig.ohvps.gatewayTokenFile,
      "OHVPS_GATEWAY_TOKEN"
    );

    const accessToken = await readSecret(
      appConfig.ohvps.accessToken,
      appConfig.ohvps.accessTokenFile,
      "OHVPS_ACCESS_TOKEN"
    );

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: bearer(gatewayToken),
      "X-Access-Token": accessToken,
      "X-TPP-Code": appConfig.ohvps.tppCode,
      "X-ASPSP-Code": appConfig.ohvps.aspspCode,
      "X-Request-ID": randomUUID(),
      "X-Group-ID": this.groupId,
      "PSU-Initiated": mode === "user" ? "E" : "H"
    };

    const fraudCheck = appConfig.ohvps.psuFraudCheckFile
      ? await readSecret("", appConfig.ohvps.psuFraudCheckFile, "OHVPS_PSU_FRAUD_CHECK")
      : appConfig.ohvps.psuFraudCheck.trim();

    if (fraudCheck) headers["PSU-Fraud-Check"] = fraudCheck;

    return headers;
  }

  private async request(path: string, params: URLSearchParams, mode: PsuMode): Promise<unknown> {
    const problems = validateLiveConfig();

    if (problems.length > 0) {
      throw new Error(`Live ÖHVPS provider is not configured: ${problems.join("; ")}`);
    }

    const url = new URL(`${appConfig.ohvps.baseUrl}${path}`);
    for (const [key, value] of params) url.searchParams.set(key, value);

    let lastError: unknown;

    for (let attempt = 0; attempt <= appConfig.httpMaxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), appConfig.httpTimeoutMs);

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: await this.headers(mode),
          signal: controller.signal
        });

        const body = await parseBody(response);

        if (response.ok) return body;

        const { code, detail } = errorDetails(body, response.status);
        const suggestedDelay = retryAfterMs(response.headers);

        if (!RETRYABLE_STATUS.has(response.status) || attempt >= appConfig.httpMaxRetries) {
          const retryText = suggestedDelay !== undefined
            ? ` Retry after approximately ${Math.ceil(suggestedDelay / 1000)} seconds.`
            : "";

          throw new OhvpsError(
            `ÖHVPS request failed: ${detail}.${retryText}`.replace(/\.\s*\./g, "."),
            response.status,
            code,
            suggestedDelay
          );
        }

        const exponentialDelay = appConfig.httpRetryBaseMs * (2 ** attempt);
        const delay = suggestedDelay ?? exponentialDelay;

        if (delay > appConfig.httpMaxRetryWaitMs) {
          throw new OhvpsError(
            `ÖHVPS request rate-limited/transiently unavailable. Retry after approximately ${Math.ceil(delay / 1000)} seconds.`,
            response.status,
            code,
            delay
          );
        }

        await sleep(delay);
      } catch (error) {
        if (error instanceof OhvpsError) throw error;

        lastError = error;
        const isAbort = error instanceof Error && error.name === "AbortError";

        if (attempt >= appConfig.httpMaxRetries) {
          if (isAbort) {
            throw new OhvpsError(`ÖHVPS request timed out after ${appConfig.httpTimeoutMs}ms`);
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

    throw lastError instanceof Error
      ? lastError
      : new OhvpsError("ÖHVPS request failed");
  }
}
