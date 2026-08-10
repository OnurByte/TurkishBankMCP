import assert from "node:assert/strict";
import test from "node:test";
import { validateWindow } from "../src/providers/ohvps.js";

test("system transaction windows accept 24 hours and reject longer windows", () => {
  assert.doesNotThrow(() => {
    validateWindow(
      "2026-08-09T00:00:00+03:00",
      "2026-08-10T00:00:00+03:00",
      "system"
    );
  });

  assert.throws(() => {
    validateWindow(
      "2026-08-09T00:00:00+03:00",
      "2026-08-10T00:00:01+03:00",
      "system"
    );
  }, /24 hours/);
});

test("user transaction windows reject ranges longer than one month", () => {
  assert.doesNotThrow(() => {
    validateWindow(
      "2026-08-01T00:00:00+03:00",
      "2026-08-31T23:59:59+03:00",
      "user"
    );
  });

  assert.throws(() => {
    validateWindow(
      "2026-08-01T00:00:00+03:00",
      "2026-09-02T00:00:00+03:00",
      "user"
    );
  }, /one month/);
});
