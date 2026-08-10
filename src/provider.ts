import { appConfig } from "./config.js";
import type { BankProvider } from "./types.js";
import { MockBankProvider } from "./providers/mock.js";
import { OhvpsProvider } from "./providers/ohvps.js";

export function createProvider(): BankProvider {
  switch (appConfig.provider) {
    case "mock":
      return new MockBankProvider();
    case "ohvps":
      return new OhvpsProvider();
    default:
      throw new Error(`Unsupported BANK_PROVIDER: ${String(appConfig.provider)}`);
  }
}
