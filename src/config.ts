import { config as loadDotEnv } from "dotenv";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(moduleDir, "..");
const defaultEnvPath = resolve(projectRoot, ".env");

loadDotEnv({
  path: process.env.TURKISH_BANK_ENV_FILE ?? defaultEnvPath,
  override: false,
  quiet: true
});

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function projectPath(value: string | undefined): string | undefined {
  const clean = value?.trim();
  if (!clean) return undefined;
  return isAbsolute(clean) ? clean : resolve(projectRoot, clean);
}

function validHttpsUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch {
    return false;
  }
}

function method(value: string | undefined): "GET" | "POST" | undefined {
  const clean = value?.trim().toUpperCase();
  return clean === "GET" || clean === "POST" ? clean : undefined;
}

export const DEFAULT_GARANTI_TOKEN_URL = "https://apis.garantibbva.com.tr/auth/oauth/v2/token";

export const appConfig = {
  httpTimeoutMs: positiveInt(process.env.HTTP_TIMEOUT_MS, 12_000),
  httpMaxRetries: Math.min(positiveInt(process.env.HTTP_MAX_RETRIES, 2), 5),
  httpRetryBaseMs: positiveInt(process.env.HTTP_RETRY_BASE_MS, 500),
  httpMaxRetryWaitMs: positiveInt(process.env.HTTP_MAX_RETRY_WAIT_MS, 5_000),
  garanti: {
    tokenUrl: process.env.GARANTI_TOKEN_URL?.trim() || DEFAULT_GARANTI_TOKEN_URL,
    clientId: process.env.GARANTI_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.GARANTI_CLIENT_SECRET ?? "",
    clientSecretFile: projectPath(process.env.GARANTI_CLIENT_SECRET_FILE),
    redirectUri: process.env.GARANTI_REDIRECT_URI?.trim() ?? "",
    accountInformationUrl: process.env.GARANTI_ACCOUNT_INFORMATION_URL?.trim() ?? "",
    accountInformationMethod: method(process.env.GARANTI_ACCOUNT_INFORMATION_METHOD),
    accountInformationBodyTemplate: process.env.GARANTI_ACCOUNT_INFORMATION_BODY_TEMPLATE ?? "",
    accountInformationContentType: process.env.GARANTI_ACCOUNT_INFORMATION_CONTENT_TYPE?.trim() ?? "application/json",
    accountTransactionsUrl: process.env.GARANTI_ACCOUNT_TRANSACTIONS_URL?.trim() ?? "",
    accountTransactionsMethod: method(process.env.GARANTI_ACCOUNT_TRANSACTIONS_METHOD),
    accountTransactionsBodyTemplate: process.env.GARANTI_ACCOUNT_TRANSACTIONS_BODY_TEMPLATE ?? "",
    accountTransactionsContentType: process.env.GARANTI_ACCOUNT_TRANSACTIONS_CONTENT_TYPE?.trim() ?? "application/json",
    extraHeadersJson: process.env.GARANTI_EXTRA_HEADERS_JSON?.trim() ?? "{}"
  }
} as const;

function validateReadOnlyEndpoint(label: string, value: string): string[] {
  if (!value) return [label];
  if (!validHttpsUrl(value.replace(/\{\{[^}]+\}\}/g, "x"))) {
    return [`${label} must be a valid HTTPS URL`];
  }

  const lower = value.toLowerCase();
  const forbidden = [
    "transfer",
    "eft",
    "payment",
    "payments",
    "bulk-transfer",
    "direct-collection",
    "loan",
    "credit-card",
    "card-management"
  ];

  if (forbidden.some((word) => lower.includes(word))) {
    return [`${label} looks like a non-read-only endpoint and was refused`];
  }

  return [];
}

export function validateLiveConfig(): string[] {
  const problems: string[] = [];
  const cfg = appConfig.garanti;

  if (!validHttpsUrl(cfg.tokenUrl)) problems.push("GARANTI_TOKEN_URL must be a valid HTTPS URL");
  if (!cfg.clientId) problems.push("GARANTI_CLIENT_ID");
  if (!cfg.redirectUri || !validHttpsUrl(cfg.redirectUri)) problems.push("GARANTI_REDIRECT_URI must match the HTTPS callback URL in Garanti Developer Portal");
  if (!cfg.clientSecret && !cfg.clientSecretFile) problems.push("GARANTI_CLIENT_SECRET or GARANTI_CLIENT_SECRET_FILE");

  problems.push(...validateReadOnlyEndpoint("GARANTI_ACCOUNT_INFORMATION_URL", cfg.accountInformationUrl));
  problems.push(...validateReadOnlyEndpoint("GARANTI_ACCOUNT_TRANSACTIONS_URL", cfg.accountTransactionsUrl));

  if (!cfg.accountInformationMethod) problems.push("GARANTI_ACCOUNT_INFORMATION_METHOD must be GET or POST");
  if (!cfg.accountTransactionsMethod) problems.push("GARANTI_ACCOUNT_TRANSACTIONS_METHOD must be GET or POST");

  try {
    const headers = JSON.parse(cfg.extraHeadersJson) as unknown;
    if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
      problems.push("GARANTI_EXTRA_HEADERS_JSON must be a JSON object");
    }
  } catch {
    problems.push("GARANTI_EXTRA_HEADERS_JSON must be valid JSON");
  }

  return problems;
}
