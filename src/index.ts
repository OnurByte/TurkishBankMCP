import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import {
  cardSpendingByCurrency,
  cashflowByCurrency,
  normalizeCardTransactions,
  normalizeTransactions
} from "./lib/normalize.js";
import { createProvider } from "./provider.js";
import type { PsuMode } from "./types.js";

const provider = createProvider();
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true
} as const;

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true
  };
}

async function cashflowSummary(args: {
  accountRef: string;
  from: string;
  to: string;
  mode: PsuMode;
}) {
  const raw = await provider.listTransactions({
    accountRef: args.accountRef,
    from: args.from,
    to: args.to,
    mode: args.mode,
    pageSize: 100
  });

  const transactions = normalizeTransactions(raw, args.accountRef);

  return {
    accountRef: args.accountRef,
    from: args.from,
    to: args.to,
    mode: args.mode,
    totals: cashflowByCurrency(transactions),
    transactions
  };
}

function dayRange(date: string, utcOffset: string) {
  return {
    from: `${date}T00:00:00${utcOffset}`,
    to: `${date}T23:59:59${utcOffset}`
  };
}

function createServer(): McpServer {
  const server = new McpServer({ name: "TurkishBankMCP", version: "0.2.0" });

  server.registerTool(
    "bank_provider_status",
    {
      description: "Show TurkishBankMCP configuration/status without returning token or credential values.",
      annotations: READ_ONLY,
      inputSchema: z.object({})
    },
    async () => jsonResult(provider.status())
  );

  server.registerTool(
    "bank_list_accounts",
    {
      description: "List bank accounts visible under the active ÖHVPS consent.",
      annotations: READ_ONLY,
      inputSchema: z.object({
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().min(1).max(100).optional()
      })
    },
    async (args) => {
      try {
        return jsonResult(await provider.listAccounts(args));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "bank_get_balances",
    {
      description: "Get current balances for accounts visible under the active ÖHVPS consent.",
      annotations: READ_ONLY,
      inputSchema: z.object({
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().min(1).max(100).optional()
      })
    },
    async (args) => {
      try {
        return jsonResult(await provider.getBalances(args));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "bank_list_transactions",
    {
      description: "List account transactions. A=credit/incoming, B=debit/outgoing. mode=user allows up to one month; mode=system is limited to 24 hours.",
      annotations: READ_ONLY,
      inputSchema: z.object({
        accountRef: z.string().min(1),
        from: z.string().min(1).describe("ISO date-time"),
        to: z.string().min(1).describe("ISO date-time"),
        mode: z.enum(["user", "system"]).default("user"),
        direction: z.enum(["A", "B"]).optional(),
        minAmount: z.number().nonnegative().optional(),
        maxAmount: z.number().nonnegative().optional(),
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().min(1).max(100).optional()
      })
    },
    async (args) => {
      try {
        return jsonResult(await provider.listTransactions(args));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "bank_cashflow_summary",
    {
      description: "Summarize incoming money, outgoing money and net cashflow for one account and date range. No FX conversion is performed.",
      annotations: READ_ONLY,
      inputSchema: z.object({
        accountRef: z.string().min(1),
        from: z.string().min(1).describe("ISO date-time"),
        to: z.string().min(1).describe("ISO date-time"),
        mode: z.enum(["user", "system"]).default("user")
      })
    },
    async ({ accountRef, from, to, mode }) => {
      try {
        return jsonResult(await cashflowSummary({ accountRef, from, to, mode }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "bank_daily_cashflow",
    {
      description: "Summarize one calendar day for an account. Intended for scheduled/cron analysis; defaults to Turkey UTC+03:00 and PSU system mode.",
      annotations: READ_ONLY,
      inputSchema: z.object({
        accountRef: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD"),
        utcOffset: z.string().regex(/^[+-](?:0\d|1[0-4]):[0-5]\d$/).default("+03:00"),
        mode: z.enum(["user", "system"]).default("system")
      })
    },
    async ({ accountRef, date, utcOffset, mode }) => {
      try {
        const range = dayRange(date, utcOffset);
        return jsonResult(await cashflowSummary({ accountRef, ...range, mode }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "bank_monthly_cashflow",
    {
      description: "Backward-compatible cashflow summary tool. Prefer bank_cashflow_summary for new clients.",
      annotations: READ_ONLY,
      inputSchema: z.object({
        accountRef: z.string().min(1),
        from: z.string().min(1),
        to: z.string().min(1)
      })
    },
    async ({ accountRef, from, to }) => {
      try {
        return jsonResult(await cashflowSummary({ accountRef, from, to, mode: "user" }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "bank_list_cards",
    {
      description: "List cards visible under the active ÖHVPS consent.",
      annotations: READ_ONLY,
      inputSchema: z.object({
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().min(1).max(100).optional()
      })
    },
    async (args) => {
      try {
        return jsonResult(await provider.listCards(args));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "bank_list_card_transactions",
    {
      description: "List card movements. B=card debit/spend, A=credit/refund, N=non-financial. Period values follow ÖHVPS card-type rules.",
      annotations: READ_ONLY,
      inputSchema: z.object({
        cardRef: z.string().min(1),
        period: z.number().int().min(-12).max(99),
        statementCurrency: z.enum(["TRY", "USD", "EUR", "GBP"]).optional(),
        direction: z.enum(["A", "B", "N"]).optional(),
        mode: z.enum(["user", "system"]).default("user"),
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().min(1).max(100).optional()
      })
    },
    async (args) => {
      try {
        return jsonResult(await provider.listCardTransactions(args));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "bank_card_spending_summary",
    {
      description: "Summarize card spending and credits by currency for an ÖHVPS card statement period. No FX conversion is performed.",
      annotations: READ_ONLY,
      inputSchema: z.object({
        cardRef: z.string().min(1),
        period: z.number().int().min(-12).max(99),
        statementCurrency: z.enum(["TRY", "USD", "EUR", "GBP"]).optional(),
        mode: z.enum(["user", "system"]).default("user")
      })
    },
    async ({ cardRef, period, statementCurrency, mode }) => {
      try {
        const raw = await provider.listCardTransactions({
          cardRef,
          period,
          statementCurrency,
          mode,
          pageSize: 100
        });

        const transactions = normalizeCardTransactions(raw, cardRef);

        return jsonResult({
          cardRef,
          period,
          mode,
          totals: cardSpendingByCurrency(transactions),
          transactions
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  return server;
}

void serveStdio(createServer);
console.error(
  `TurkishBankMCP running on stdio (provider=${provider.name}, OHVPS=${provider.specVersion}, read-only=true)`
);
