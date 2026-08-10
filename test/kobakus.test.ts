import assert from "node:assert/strict";
import test from "node:test";
import { kobakusDateChunks } from "../src/providers/kobakus.js";
import { normalizeTransactions } from "../src/lib/normalize.js";

test("Kobakus long date ranges are split into small requests", () => {
  const chunks = kobakusDateChunks(
    "2026-08-01T00:00:00+03:00",
    "2026-08-20T23:59:59+03:00"
  );

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0]?.startDate, "2026-08-01 00:00:00");
  assert.equal(chunks[0]?.endDate, "2026-08-07 23:59:59");
  assert.equal(chunks[2]?.endDate, "2026-08-20 23:59:59");
});

test("canonical provider transactions are understood by cashflow normalization", () => {
  const payload = {
    provider: "kobakus",
    transactions: [
      {
        id: "1",
        accountRef: "TR001",
        amount: 2500,
        currency: "TRY",
        direction: "A",
        occurredAt: "2026-08-10T09:00:00+03:00",
        description: "Maaş"
      },
      {
        id: "2",
        accountRef: "TR001",
        amount: 400,
        currency: "TRY",
        direction: "B",
        occurredAt: "2026-08-10T12:00:00+03:00",
        description: "Market"
      }
    ]
  };

  const normalized = normalizeTransactions(payload, "TR001");

  assert.equal(normalized.length, 2);
  assert.equal(normalized[0]?.direction, "A");
  assert.equal(normalized[1]?.direction, "B");
});
