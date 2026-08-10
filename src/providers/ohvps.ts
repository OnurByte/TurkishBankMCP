import { randomUUID } from "node:crypto";
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

function bearer(value: string): string {
  return /^Bearer\s/i.test(value) ? value : `Bearer ${value}`;
}

function pageParams(options: PageOptions = {}) {
  const params = new URLSearchParams();
  if (options.page !== undefined) params.set("syfNo", String(options.page));
  if (options.pageSize !== undefined) params.set("syfKytSayi", String(Math.min(options.pageSize, 100)));
  return params;
}

function validateWindow(from: string, to: string, mode: PsuMode) {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("from/to must be valid ISO date-time values");
  if (end < start) throw new Error("to must be equal to or later than from");

  const windowMs = end - start;
  const maxMs = mode === "system" ? 24 * 60 * 60 * 1000 : 31 * 24 * 60 * 60 * 1000;
  if (windowMs > maxMs) {
    throw new Error(mode === "system"
      ? "ÖHVPS 2.0.0 system-triggered transaction queries are limited to 24 hours"
      : "ÖHVPS 2.0.0 individual user-triggered transaction queries are limited to one month");
  }
}

export class OhvpsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "OhvpsError";
  }
}

export class OhvpsProvider implements BankProvider {
  readonly name = "ohvps";
  readonly specVersion = appConfig.specVersion;
  private readonly cache = new TimedCache();

  status() {
    const missing = validateLiveConfig();
    return {
      provider: this.name,
      specVersion: this.specVersion,
      live: true,
      readOnly: true,
      configured: missing.length === 0,
      missing,
      credentials: {
        gatewayTokenPresent: Boolean(appConfig.ohvps.gatewayToken),
        accessTokenPresent: Boolean(appConfig.ohvps.accessToken),
        tppCodePresent: Boolean(appConfig.ohvps.tppCode),
        aspspCodePresent: Boolean(appConfig.ohvps.aspspCode)
      }
    };
  }

  async listAccounts(options: PageOptions = {}) {
    const params = pageParams(options);
    const cacheKey = `accounts:${params}`;
    return this.cache.getOrCreate(cacheKey, CACHE_TTL.accounts, () => this.request("/hesaplar", params, "system"));
  }

  async getBalances(options: PageOptions = {}) {
    const params = pageParams(options);
    const cacheKey = `balances:${params}`;
    return this.cache.getOrCreate(cacheKey, CACHE_TTL.balances, () => this.request("/bakiye", params, "system"));
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
    const cacheKey = `transactions:${path}:${mode}:${params}`;
    return this.cache.getOrCreate(cacheKey, CACHE_TTL.transactions, () => this.request(path, params, mode));
  }

  async listCards(options: PageOptions = {}) {
    const params = pageParams(options);
    const cacheKey = `cards:${params}`;
    return this.cache.getOrCreate(cacheKey, CACHE_TTL.cards, () => this.request("/kartlar", params, "system"));
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
    const cacheKey = `card-transactions:${path}:${mode}:${params}`;
    return this.cache.getOrCreate(cacheKey, CACHE_TTL.cardTransactions, () => this.request(path, params, mode));
  }

  private async request(path: string, params: URLSearchParams, mode: PsuMode): Promise<unknown> {
    const missing = validateLiveConfig();
    if (missing.length > 0) {
      throw new Error(`Live ÖHVPS provider is not configured. Missing: ${missing.join(", ")}`);
    }

    const url = new URL(`${appConfig.ohvps.baseUrl}${path}`);
    for (const [key, value] of params) url.searchParams.set(key, value);

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: bearer(appConfig.ohvps.gatewayToken),
      "X-Access-Token": appConfig.ohvps.accessToken,
      "X-TPP-Code": appConfig.ohvps.tppCode,
      "X-ASPSP-Code": appConfig.ohvps.aspspCode,
      "X-Request-ID": randomUUID(),
      "X-Group-ID": appConfig.ohvps.groupId || randomUUID(),
      "PSU-Initiated": mode === "user" ? "E" : "H"
    };

    if (appConfig.ohvps.psuFraudCheck) headers["PSU-Fraud-Check"] = appConfig.ohvps.psuFraudCheck;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), appConfig.httpTimeoutMs);

    try {
      const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
      const contentType = response.headers.get("content-type") ?? "";
      const body = contentType.includes("application/json") ? await response.json() : await response.text();

      if (!response.ok) {
        const record = body && typeof body === "object" ? body as Record<string, unknown> : undefined;
        const code = typeof record?.errorCode === "string" ? record.errorCode : undefined;
        const detail = typeof record?.moreInformationTr === "string"
          ? record.moreInformationTr
          : typeof record?.moreInformation === "string"
            ? record.moreInformation
            : `HTTP ${response.status}`;
        throw new OhvpsError(`ÖHVPS request failed: ${detail}`, response.status, code);
      }

      return body;
    } catch (error) {
      if (error instanceof OhvpsError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new OhvpsError(`ÖHVPS request timed out after ${appConfig.httpTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
