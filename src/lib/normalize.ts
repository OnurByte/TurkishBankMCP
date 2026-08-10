import type { NormalizedCardTransaction, NormalizedTransaction } from "../types.js";
import { asRecord, findArrayByKey, numberValue, stringValue } from "./json.js";

function normalizeCanonicalTransactions(payload: unknown, accountRef?: string): NormalizedTransaction[] | undefined {
  const rows = findArrayByKey(payload, "transactions");
  if (rows.length === 0) return undefined;

  const transactions = rows.flatMap((item) => {
    const row = asRecord(item);
    if (!row) return [];

    const amount = numberValue(row.amount);
    const currency = stringValue(row.currency);
    const direction = row.direction;

    if (amount === undefined || !currency || (direction !== "A" && direction !== "B")) return [];

    return [{
      id: stringValue(row.id),
      reference: stringValue(row.reference),
      accountRef: stringValue(row.accountRef) ?? accountRef,
      amount,
      currency,
      direction,
      occurredAt: stringValue(row.occurredAt),
      description: stringValue(row.description),
      counterparty: stringValue(row.counterparty),
      balanceAfter: numberValue(row.balanceAfter),
      raw: row.raw ?? item
    } satisfies NormalizedTransaction];
  });

  return transactions.length === rows.length ? transactions : undefined;
}

export function normalizeTransactions(payload: unknown, accountRef?: string): NormalizedTransaction[] {
  const canonical = normalizeCanonicalTransactions(payload, accountRef);
  if (canonical) return canonical;

  return findArrayByKey(payload, "isller").flatMap((item) => {
    const row = asRecord(item);
    if (!row) return [];

    const base = asRecord(row.islTml) ?? row;
    const detail = asRecord(row.islDty);
    const counterparty = asRecord(detail?.krsTrf);
    const direction = base.brcAlc;
    const amount = numberValue(base.islTtr);
    const currency = stringValue(base.prBrm);

    if ((direction !== "A" && direction !== "B") || amount === undefined || !currency) return [];

    return [{
      id: stringValue(base.islNo),
      reference: stringValue(base.refNo),
      accountRef,
      amount,
      currency,
      direction,
      occurredAt: stringValue(base.islGrckZaman),
      description: stringValue(detail?.islAcklm),
      counterparty: stringValue(counterparty?.krsUnvan),
      balanceAfter: numberValue(base.gnclBky),
      raw: item
    } satisfies NormalizedTransaction];
  });
}

export function normalizeCardTransactions(payload: unknown, cardRef?: string): NormalizedCardTransaction[] {
  return findArrayByKey(payload, "hareketBilgileri").flatMap((item) => {
    const row = asRecord(item);
    if (!row) return [];

    const amountObject = asRecord(row.islemTutari);
    const amount = numberValue(amountObject?.tutar);
    const currency = stringValue(amountObject?.paraBirimi);
    const direction = row.borcAlacak;

    if ((direction !== "A" && direction !== "B" && direction !== "N") || amount === undefined || !currency) {
      return [];
    }

    return [{
      id: stringValue(row.islemNo),
      cardRef,
      amount,
      currency,
      direction,
      occurredAt: stringValue(row.islemTarihi),
      description: stringValue(row.islemAciklamasi),
      raw: item
    } satisfies NormalizedCardTransaction];
  });
}

export function cashflowByCurrency(transactions: NormalizedTransaction[]) {
  const totals = new Map<string, { currency: string; incoming: number; outgoing: number; net: number; count: number }>();

  for (const tx of transactions) {
    const current = totals.get(tx.currency) ?? {
      currency: tx.currency,
      incoming: 0,
      outgoing: 0,
      net: 0,
      count: 0
    };

    if (tx.direction === "A") current.incoming += tx.amount;
    if (tx.direction === "B") current.outgoing += tx.amount;
    current.net = current.incoming - current.outgoing;
    current.count += 1;
    totals.set(tx.currency, current);
  }

  return [...totals.values()];
}

export function cardSpendingByCurrency(transactions: NormalizedCardTransaction[]) {
  const totals = new Map<string, { currency: string; spending: number; credits: number; netSpending: number; count: number }>();

  for (const tx of transactions) {
    if (tx.direction === "N") continue;
    const current = totals.get(tx.currency) ?? {
      currency: tx.currency,
      spending: 0,
      credits: 0,
      netSpending: 0,
      count: 0
    };

    if (tx.direction === "B") current.spending += tx.amount;
    if (tx.direction === "A") current.credits += tx.amount;
    current.netSpending = current.spending - current.credits;
    current.count += 1;
    totals.set(tx.currency, current);
  }

  return [...totals.values()];
}
