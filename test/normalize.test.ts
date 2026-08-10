import assert from "node:assert/strict";
import test from "node:test";
import {
  cardSpendingByCurrency,
  cashflowByCurrency,
  normalizeCardTransactions,
  normalizeTransactions
} from "../src/lib/normalize.js";

test("normalizes official-style account transaction payloads", () => {
  const payload = {
    hspRef: "account-1",
    isller: [
      {
        islTml: {
          islNo: "1",
          refNo: "r1",
          islTtr: "100.50",
          gnclBky: "500.25",
          prBrm: "TRY",
          islGrckZaman: "2026-08-10T09:00:00+03:00",
          brcAlc: "A"
        },
        islDty: {
          islAcklm: "Maaş",
          krsTrf: { krsUnvan: "Şirket" }
        }
      },
      {
        islTml: {
          islNo: "2",
          refNo: "r2",
          islTtr: "20.25",
          gnclBky: "480.00",
          prBrm: "TRY",
          islGrckZaman: "2026-08-10T10:00:00+03:00",
          brcAlc: "B"
        },
        islDty: { islAcklm: "Kahve" }
      }
    ]
  };

  const tx = normalizeTransactions(payload, "account-1");

  assert.equal(tx.length, 2);
  assert.equal(tx[0]?.counterparty, "Şirket");
  assert.deepEqual(cashflowByCurrency(tx), [{
    currency: "TRY",
    incoming: 100.5,
    outgoing: 20.25,
    net: 80.25,
    count: 2
  }]);
});

test("normalizes card movements and ignores non-financial movements in spending totals", () => {
  const payload = {
    hareketBilgileri: [
      {
        islemNo: "c1",
        islemTutari: { tutar: "200.00", paraBirimi: "TRY" },
        islemTarihi: "2026-08-10T12:00:00+03:00",
        borcAlacak: "B",
        islemAciklamasi: "MARKET"
      },
      {
        islemNo: "c2",
        islemTutari: { tutar: "25.00", paraBirimi: "TRY" },
        islemTarihi: "2026-08-10T13:00:00+03:00",
        borcAlacak: "A",
        islemAciklamasi: "IADE"
      },
      {
        islemNo: "c3",
        islemTutari: { tutar: "1.00", paraBirimi: "TRY" },
        islemTarihi: "2026-08-10T14:00:00+03:00",
        borcAlacak: "N",
        islemAciklamasi: "BILGI"
      }
    ]
  };

  const tx = normalizeCardTransactions(payload, "card-1");

  assert.equal(tx.length, 3);
  assert.deepEqual(cardSpendingByCurrency(tx), [{
    currency: "TRY",
    spending: 200,
    credits: 25,
    netSpending: 175,
    count: 2
  }]);
});
