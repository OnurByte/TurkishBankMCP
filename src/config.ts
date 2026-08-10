import { config as loadDotEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultEnvPath = resolve(moduleDir, "../.env");
loadDotEnv({ path: process.env.TURKISH_BANK_ENV_FILE ?? defaultEnvPath, override: false, quiet: true });

export type ProviderKind = "mock" | "ohvps";

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export const appConfig = {
  provider: (process.env.BANK_PROVIDER ?? "mock") as ProviderKind,
  specVersion: process.env.OHVPS_SPEC_VERSION ?? "2.0.0",
  httpTimeoutMs: positiveInt(process.env.HTTP_TIMEOUT_MS, 12_000),
  ohvps: {
    baseUrl: trimTrailingSlash(process.env.OHVPS_BASE_URL ?? ""),
    tppCode: process.env.OHVPS_TPP_CODE ?? "",
    aspspCode: process.env.OHVPS_ASPSP_CODE ?? "",
    gatewayToken: process.env.OHVPS_GATEWAY_TOKEN ?? "",
    accessToken: process.env.OHVPS_ACCESS_TOKEN ?? "",
    groupId: process.env.OHVPS_GROUP_ID ?? "",
    psuFraudCheck: process.env.OHVPS_PSU_FRAUD_CHECK ?? ""
  }
} as const;

export function validateLiveConfig(): string[] {
  if (appConfig.provider !== "ohvps") return [];

  const missing: string[] = [];
  if (!appConfig.ohvps.baseUrl) missing.push("OHVPS_BASE_URL");
  if (!appConfig.ohvps.tppCode) missing.push("OHVPS_TPP_CODE");
  if (!appConfig.ohvps.aspspCode) missing.push("OHVPS_ASPSP_CODE");
  if (!appConfig.ohvps.gatewayToken) missing.push("OHVPS_GATEWAY_TOKEN");
  if (!appConfig.ohvps.accessToken) missing.push("OHVPS_ACCESS_TOKEN");
  return missing;
}
