import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { cardSpendingByCurrency, cashflowByCurrency, normalizeCardTransactions, normalizeTransactions } from "./lib/normalize.js";
import { createProvider } from "./provider.js";

const provider = createProvider();

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value && typeof value === "object" ? value as Record<string, unknown> : undefined
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true
  };
}

function createServer(): McpServer {
  const server = new McpServer({ name: "TurkishBankMCP", version: "0.1.0" });

  server.registerTool(
    "bank_provider_status",
    {
      description: "Show TurkishBankMCP provider status and whether required credentials are present. Never returns secret values.",
      inputSchema: z.object({})
    },
    async () => jsonResult(provider.status())
  );

  server.registerTool(
    "bank_list_accounts",
    {
      description: "List bank accounts visible under the active ÖHVPS consent. Read-only.",
      inputSchema: z.object({
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().min(1).max(100).optional()
      })
    },
    async (args) => {
      try { return jsonResult(await provider.listAccounts(args)); }
      catch (error) { return errorResult(error); }
    }
  );

  server.registerTool(
    "bank_get_balances",
    {
      description: "Get current balances for accounts visible under the active ÖHVPS consent. Read-only.",
      inputSchema: z.object({
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().min(1).max(100).optional()
      })
    },
    async (args) => {
      try { return jsonResult(await provider.getBalances(args)); }
      catch (error) { return errorResult(error); }
    }
  );

  server.registerTool(
    "bank_list_transactions",
    {
      description: "List account transactions. A=credit/incoming, B=debit/outgoing. User-triggered windows are capped at one month; system-triggered windows at 24 hours.",
      inputSchema: z.object({
        accountRef: z.string().min(1),
        from: z.string().min(1).describe("ISO date-time or date accepted by the provider"),
        to: z.string().min(1).describe("ISO date-time or date accepted by the provider"),
        mode: z.enum(["user", "system"]).default("user"),
        direction: z.enum(["A", "B"]).optional(),
        minAmount: z.number().nonnegative().optional(),
        maxAmount: z.number().nonnegative().optional(),
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().min(1).max(100).optional()
      })
    },
    async (args) => {
      try { return jsonResult(await provider.listTransactions(args)); }
      catch (error) { return errorResult(error); }
    }
  );

  server.registerTool(
    "bank_monthly_cashflow",
    {
      description: "Summarize incoming money, outgoing money and net cashflow by currency from one account. No FX conversion is performed.",
      inputSchema: z.object({
        accountRef: z.string().min(1),
        from: z.string().min(1),
        to: z.string().min(1)
      })
    },
    async ({ accountRef, from, to }) => {
      try {
        const raw = await provider.listTransactions({ accountRef, from, to, mode: "user", pageSize: 100 });
        const transactions = normalizeTransactions(raw, accountRef);
        return jsonResult({ accountRef, from, to, totals: cashflowByCurrency(transactions), transactions });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "bank_list_cards",
    {
      description: "List debit, credit, prepaid or virtual cards visible under the active ÖHVPS consent. Read-only.",
      inputSchema: z.object({
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().min(1).max(100).optional()
      })
    },
    async (args) => {
      try { return jsonResult(await provider.listCards(args)); }
      catch (error) { return errorResult(error); }
    }
  );

  server.registerTool(
    "bank_list_card_transactions",
    {
      description: "List card movements. B=card debit/spend, A=credit/refund, N=non-financial. period supports 99 or -12..18; actual allowed values depend on card type.",
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
      try { return jsonResult(await provider.listCardTransactions(args)); }
      catch (error) { return errorResult(error); }
    }
  );

  server.registerTool(
    "bank_card_spending_summary",
    {
      description: "Summarize card spending and credits by currency for an ÖHVPS card statement period. No FX conversion is performed.",
      inputSchema: z.object({
        cardRef: z.string().min(1),
        period: z.number().int().min(-12).max(99),
        statementCurrency: z.enum(["TRY", "USD", "EUR", "GBP"]).optional()
      })
    },
    async ({ cardRef, period, statementCurrency }) => {
      try {
        const raw = await provider.listCardTransactions({ cardRef, period, statementCurrency, mode: "user", pageSize: 100 });
        const transactions = normalizeCardTransactions(raw, cardRef);
        return jsonResult({ cardRef, period, totals: cardSpendingByCurrency(transactions), transactions });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  return server;
}

void serveStdio(createServer);
console.error(`TurkishBankMCP running on stdio (provider=${provider.name}, OHVPS=${provider.specVersion}, read-only=true)`);
