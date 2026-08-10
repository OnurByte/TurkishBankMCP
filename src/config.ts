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

export type ProviderKind = "mock" | "ohvps";

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function projectPath(value: string | undefined): string | undefined {
  const clean = value?.trim();
  if (!clean) return undefined;
  return isAbsolute(clean) ? clean : resolve(projectRoot, clean);
}

function cachePath(value: string | undefined): string | undefined {
  const clean = (value ?? ".data/cache.json").trim();
  if (!clean || /^(off|false|none)$/i.test(clean)) return undefined;
  return projectPath(clean);
}

export const SUPPORTED_OHVPS_VERSION = "2.0.0";

export const appConfig = {
  provider: (process.env.BANK_PROVIDER ?? "mock") as ProviderKind,
  specVersion: process.env.OHVPS_SPEC_VERSION ?? SUPPORTED_OHVPS_VERSION,
  cacheFile: cachePath(process.env.CACHE_FILE),
  httpTimeoutMs: positiveInt(process.env.HTTP_TIMEOUT_MS, 12_000),
  httpMaxRetries: Math.min(positiveInt(process.env.HTTP_MAX_RETRIES, 2), 5),
  httpRetryBaseMs: positiveInt(process.env.HTTP_RETRY_BASE_MS, 500),
  httpMaxRetryWaitMs: positiveInt(process.env.HTTP_MAX_RETRY_WAIT_MS, 5_000),
  ohvps: {
    baseUrl: trimTrailingSlash(process.env.OHVPS_BASE_URL ?? ""),
    tppCode: process.env.OHVPS_TPP_CODE ?? "",
    aspspCode: process.env.OHVPS_ASPSP_CODE ?? "",
    gatewayToken: process.env.OHVPS_GATEWAY_TOKEN ?? "",
    gatewayTokenFile: projectPath(process.env.OHVPS_GATEWAY_TOKEN_FILE),
    accessToken: process.env.OHVPS_ACCESS_TOKEN ?? "",
    accessTokenFile: projectPath(process.env.OHVPS_ACCESS_TOKEN_FILE),
    groupId: process.env.OHVPS_GROUP_ID ?? "",
    psuFraudCheck: process.env.OHVPS_PSU_FRAUD_CHECK ?? "",
    psuFraudCheckFile: projectPath(process.env.OHVPS_PSU_FRAUD_CHECK_FILE)
  }
} as const;

function validBaseUrl(value: string): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

export function validateLiveConfig(): string[] {
  if (appConfig.provider !== "ohvps") return [];

  const problems: string[] = [];

  if (appConfig.specVersion !== SUPPORTED_OHVPS_VERSION) {
    problems.push(`OHVPS_SPEC_VERSION must be ${SUPPORTED_OHVPS_VERSION}`);
  }

  if (!appConfig.ohvps.baseUrl) {
    problems.push("OHVPS_BASE_URL");
  } else if (!validBaseUrl(appConfig.ohvps.baseUrl)) {
    problems.push("OHVPS_BASE_URL must be a valid HTTPS URL (HTTP is allowed only for localhost)");
  }

  if (!appConfig.ohvps.tppCode) problems.push("OHVPS_TPP_CODE");
  if (!appConfig.ohvps.aspspCode) problems.push("OHVPS_ASPSP_CODE");

  const hasGatewayToken = Boolean(appConfig.ohvps.gatewayToken || appConfig.ohvps.gatewayTokenFile);
  const hasAccessToken = Boolean(appConfig.ohvps.accessToken || appConfig.ohvps.accessTokenFile);

  if (!hasGatewayToken) problems.push("OHVPS_GATEWAY_TOKEN or OHVPS_GATEWAY_TOKEN_FILE");
  if (!hasAccessToken) problems.push("OHVPS_ACCESS_TOKEN or OHVPS_ACCESS_TOKEN_FILE");

  return problems;
}
