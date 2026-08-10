import type { BankProvider } from "./types.js";
import { GarantiProvider } from "./providers/garanti.js";

export function createProvider(): BankProvider {
  return new GarantiProvider();
}
