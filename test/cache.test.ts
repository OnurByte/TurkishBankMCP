import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TimedCache } from "../src/lib/cache.js";

test("TimedCache persists values across instances", async () => {
  const dir = await mkdtemp(join(tmpdir(), "turkish-bank-mcp-"));
  const file = join(dir, "cache.json");

  try {
    let calls = 0;
    const first = new TimedCache(file);

    const value1 = await first.getOrCreate("balance", 60_000, async () => {
      calls += 1;
      return { amount: 100 };
    });

    assert.deepEqual(value1, { amount: 100 });
    assert.equal(calls, 1);

    const second = new TimedCache(file);
    const value2 = await second.getOrCreate("balance", 60_000, async () => {
      calls += 1;
      return { amount: 999 };
    });

    assert.deepEqual(value2, { amount: 100 });
    assert.equal(calls, 1);

    const state = JSON.parse(await readFile(file, "utf8")) as { version: number };
    assert.equal(state.version, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("TimedCache coalesces concurrent identical requests", async () => {
  const cache = new TimedCache();
  let calls = 0;

  const factory = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return "ok";
  };

  const values = await Promise.all([
    cache.getOrCreate("same", 1_000, factory),
    cache.getOrCreate("same", 1_000, factory),
    cache.getOrCreate("same", 1_000, factory)
  ]);

  assert.deepEqual(values, ["ok", "ok", "ok"]);
  assert.equal(calls, 1);
});
