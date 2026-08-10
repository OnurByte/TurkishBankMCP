import { readFile } from "node:fs/promises";
import { appConfig, validateLiveConfig } from "../config.js";
import type { BankProvider, PageOptions, TransactionQuery } from "../types.js";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

type Vars = Record<string, string | number | undefined>;

export class GarantiApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMilliseconds?: number
  ) {
    super(message);
    this.name = "GarantiApiError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function publicError(body: unknown, status: number): string {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const row = body as Record<string, unknown>;
    for (const key of ["error_description", "message", "errorMessage", "error", "description"]) {
      const value = row[key];
      if (typeof value === "string" && value.trim()) return value.trim().slice(0, 500);
    }
  }
  return `HTTP ${status}`;
}

function replaceTemplate(template: string, vars: Vars, encoding: "url" | "json" | "form" | "raw"): string {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    const text = value === undefined ? "" : String(value);
    if (encoding === "url" || encoding === "form") return encodeURIComponent(text);
    if (encoding === "json") return JSON.stringify(text).slice(1, -1);
    return text;
  });
}

function renderUrl(template: string, vars: Vars): string {
  return replaceTemplate(template, vars, "url");
}

function renderBody(template: string, contentType: string, vars: Vars): string | undefined {
  if (!template.trim()) return undefined;
  const lower = contentType.toLowerCase();
  if (lower.includes("application/json")) return replaceTemplate(template, vars, "json");
  if (lower.includes("application/x-www-form-urlencoded")) return replaceTemplate(template, vars, "form");
  return replaceTemplate(template, vars, "raw");
}

function appendGetTemplate(urlValue: string, body: string | undefined, contentType: string): string {
  if (!body) return urlValue;
  const url = new URL(urlValue);

  if (contentType.toLowerCase().includes("application/json")) {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new GarantiApiError("GET request template must be a JSON object");
    }
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  for (const [key, value] of new URLSearchParams(body)) url.searchParams.set(key, value);
  return url.toString();
}

async function readClientSecret(): Promise<string> {
  const cfg = appConfig.garanti;
  if (cfg.clientSecretFile) {
    try {
      const value = (await readFile(cfg.clientSecretFile, "utf8")).trim();
      if (!value) throw new Error("file is empty");
      return value;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new GarantiApiError(`GARANTI_CLIENT_SECRET_FILE could not be read: ${detail}`);
    }
  }
  const value = cfg.clientSecret.trim();
  if (!value) throw new GarantiApiError("GARANTI_CLIENT_SECRET is not configured");
  return value;
}

function extraHeaders(): Record<string, string> {
  const parsed = JSON.parse(appConfig.garanti.extraHeadersJson) as Record<string, unknown>;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const lower = key.toLowerCase();
    if (lower === "authorization" || lower === "content-length" || lower === "host") continue;
    if (typeof value === "string") headers[key] = value;
  }
  return headers;
}

export class GarantiProvider implements BankProvider {
  readonly name = "garanti-api-store";
  readonly specVersion = "OAuth2/client_credentials";

  private token?: { value: string; expiresAt: number };

  status() {
    const cfg = appConfig.garanti;
    const problems = validateLiveConfig();
    return {
      provider: this.name,
      live: true,
      readOnly: true,
      configured: problems.length === 0,
      problems,
      tokenUrl: cfg.tokenUrl,
      accountInformationConfigured: Boolean(cfg.accountInformationUrl && cfg.accountInformationMethod),
      accountTransactionsConfigured: Boolean(cfg.accountTransactionsUrl && cfg.accountTransactionsMethod),
      credentials: {
        clientIdConfigured: Boolean(cfg.clientId),
        clientSecretConfigured: Boolean(cfg.clientSecret || cfg.clientSecretFile),
        clientSecretFileConfigured: Boolean(cfg.clientSecretFile),
        redirectUriConfigured: Boolean(cfg.redirectUri)
      },
      safety: {
        paymentTools: false,
        transferTools: false,
        cardManagementTools: false,
        endpointDenylistEnabled: true
      }
    };
  }

  async testConnection() {
    this.assertConfigured();
    await this.accessToken(true);
    return { provider: this.name, oauth: "ok", readOnly: true };
  }

  async listAccounts(options: PageOptions = {}) {
    return this.requestProduct(
      appConfig.garanti.accountInformationUrl,
      appConfig.garanti.accountInformationMethod!,
      appConfig.garanti.accountInformationBodyTemplate,
      appConfig.garanti.accountInformationContentType,
      { page: options.page, pageSize: options.pageSize }
    );
  }

  async getBalances(options: PageOptions = {}) {
    return this.listAccounts(options);
  }

  async listTransactions(query: TransactionQuery) {
    if (!query.accountRef.trim()) throw new GarantiApiError("accountRef is required");
    if (!Number.isFinite(Date.parse(query.from)) || !Number.isFinite(Date.parse(query.to))) {
      throw new GarantiApiError("from/to must be valid ISO date-time values");
    }
    if (Date.parse(query.to) < Date.parse(query.from)) throw new GarantiApiError("to must be equal to or later than from");

    return this.requestProduct(
      appConfig.garanti.accountTransactionsUrl,
      appConfig.garanti.accountTransactionsMethod!,
      appConfig.garanti.accountTransactionsBodyTemplate,
      appConfig.garanti.accountTransactionsContentType,
      {
        accountRef: query.accountRef,
        from: query.from,
        to: query.to,
        direction: query.direction,
        minAmount: query.minAmount,
        maxAmount: query.maxAmount,
        page: query.page,
        pageSize: query.pageSize
      }
    );
  }

  private assertConfigured() {
    const problems = validateLiveConfig();
    if (problems.length) throw new GarantiApiError(`Garanti API Store is not configured: ${problems.join("; ")}`);
  }

  private async accessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token && this.token.expiresAt - Date.now() > 60_000) return this.token.value;

    const cfg = appConfig.garanti;
    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: await readClientSecret(),
      redirect_uri: cfg.redirectUri
    });

    const response = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(appConfig.httpTimeoutMs)
    });
    const body = await parseBody(response);
    if (!response.ok) throw new GarantiApiError(`Garanti OAuth failed: ${publicError(body, response.status)}`, response.status);

    if (!body || typeof body !== "object" || Array.isArray(body)) throw new GarantiApiError("Garanti OAuth response is not a JSON object");
    const record = body as Record<string, unknown>;
    const accessToken = typeof record.access_token === "string" ? record.access_token : undefined;
    if (!accessToken) throw new GarantiApiError("Garanti OAuth response did not contain access_token");

    const expiresIn = typeof record.expires_in === "number"
      ? record.expires_in
      : typeof record.expires_in === "string" ? Number(record.expires_in) : 300;
    const ttlMs = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 300_000;
    this.token = { value: accessToken, expiresAt: Date.now() + ttlMs };
    return accessToken;
  }

  private async requestProduct(
    urlTemplate: string,
    method: "GET" | "POST",
    bodyTemplate: string,
    contentType: string,
    vars: Vars
  ): Promise<unknown> {
    this.assertConfigured();

    let url = renderUrl(urlTemplate, vars);
    const renderedBody = renderBody(bodyTemplate, contentType, vars);
    if (method === "GET") url = appendGetTemplate(url, renderedBody, contentType);

    let refreshedAfter401 = false;
    let lastError: unknown;

    for (let attempt = 0; attempt <= appConfig.httpMaxRetries; attempt += 1) {
      try {
        const headers: Record<string, string> = {
          Accept: "application/json",
          Authorization: `Bearer ${await this.accessToken()}`,
          ...extraHeaders()
        };
        if (method === "POST" && renderedBody !== undefined) headers["Content-Type"] = contentType;

        const response = await fetch(url, {
          method,
          headers,
          body: method === "POST" ? renderedBody : undefined,
          signal: AbortSignal.timeout(appConfig.httpTimeoutMs)
        });
        const body = await parseBody(response);

        if (response.ok) return body;

        if (response.status === 401 && !refreshedAfter401) {
          this.token = undefined;
          await this.accessToken(true);
          refreshedAfter401 = true;
          continue;
        }

        const suggestedDelay = retryAfterMs(response.headers);
        if (!RETRYABLE_STATUS.has(response.status) || attempt >= appConfig.httpMaxRetries) {
          throw new GarantiApiError(
            `Garanti API request failed: ${publicError(body, response.status)}`,
            response.status,
            suggestedDelay
          );
        }

        const delay = suggestedDelay ?? appConfig.httpRetryBaseMs * (2 ** attempt);
        if (delay > appConfig.httpMaxRetryWaitMs) {
          throw new GarantiApiError(
            `Garanti API temporarily unavailable or rate limited. Retry after about ${Math.ceil(delay / 1000)} seconds.`,
            response.status,
            delay
          );
        }
        await sleep(delay);
      } catch (error) {
        if (error instanceof GarantiApiError) throw error;
        lastError = error;
        if (attempt >= appConfig.httpMaxRetries) {
          const message = error instanceof Error && error.name === "TimeoutError"
            ? `Garanti API request timed out after ${appConfig.httpTimeoutMs}ms`
            : error instanceof Error ? error.message : String(error);
          throw new GarantiApiError(message);
        }
        await sleep(Math.min(appConfig.httpRetryBaseMs * (2 ** attempt), appConfig.httpMaxRetryWaitMs));
      }
    }

    throw lastError instanceof Error ? lastError : new GarantiApiError("Garanti API request failed");
  }
}
