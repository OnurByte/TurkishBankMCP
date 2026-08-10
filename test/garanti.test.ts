import assert from "node:assert/strict";
import test from "node:test";
import { appConfig } from "../src/config.js";
import { GarantiProvider } from "../src/providers/garanti.js";

test("Garanti provider gets OAuth token and never returns it", async () => {
  const cfg = appConfig.garanti as unknown as Record<string, unknown>;
  Object.assign(cfg, {
    tokenUrl: "https://apis.garantibbva.com.tr/auth/oauth/v2/token",
    clientId: "client-id",
    clientSecret: "client-secret",
    clientSecretFile: undefined,
    redirectUri: "https://example.test/callback",
    accountInformationUrl: "https://apis.garantibbva.com.tr/account-information",
    accountInformationMethod: "GET",
    accountInformationBodyTemplate: "",
    accountInformationContentType: "application/json",
    accountTransactionsUrl: "https://apis.garantibbva.com.tr/account-transactions?account={{accountRef}}&from={{from}}&to={{to}}",
    accountTransactionsMethod: "GET",
    accountTransactionsBodyTemplate: "",
    accountTransactionsContentType: "application/json",
    extraHeadersJson: "{}"
  });

  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; authorization?: string }> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, authorization: headers.get("authorization") ?? undefined });

    if (url.includes("/auth/oauth/v2/token")) {
      return new Response(JSON.stringify({ access_token: "super-secret-token", expires_in: 300 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const provider = new GarantiProvider();
    const connection = await provider.testConnection();
    assert.deepEqual(connection, { provider: "garanti-api-store", oauth: "ok", readOnly: true });
    assert.equal(JSON.stringify(connection).includes("super-secret-token"), false);

    const result = await provider.listTransactions({
      accountRef: "TR 12/34",
      from: "2026-08-10T00:00:00+03:00",
      to: "2026-08-10T23:59:59+03:00"
    });

    assert.deepEqual(result, { ok: true });
    const apiCall = calls.find((call) => call.url.includes("account-transactions"));
    assert.ok(apiCall);
    assert.match(apiCall.url, /TR%2012%2F34/);
    assert.equal(apiCall.authorization, "Bearer super-secret-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
