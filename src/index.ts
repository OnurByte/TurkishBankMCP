import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { createProvider } from "./provider.js";

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

function createServer(): McpServer {
  const server = new McpServer({ name: "TurkishBankMCP", version: "0.4.0" });

  server.registerTool(
    "bank_provider_status",
    {
      description: "Show Garanti API Store configuration status without exposing credentials.",
      annotations: READ_ONLY,
      inputSchema: z.object({})
    },
    async () => jsonResult(provider.status())
  );

  server.registerTool(
    "bank_test_connection",
    {
      description: "Test Garanti OAuth client_credentials authentication. The access token is never returned.",
      annotations: READ_ONLY,
      inputSchema: z.object({})
    },
    async () => {
      try {
        return jsonResult(await provider.testConnection());
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "bank_list_accounts",
    {
      description: "Call Garanti Account Information and return its read-only response.",
      annotations: READ_ONLY,
      inputSchema: z.object({
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().min(1).max(1000).optional()
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
      description: "Read account information from Garanti. This uses the same Account Information product because the public portal does not document a separate balance API.",
      annotations: READ_ONLY,
      inputSchema: z.object({
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().min(1).max(1000).optional()
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
      description: "Call Garanti Account Transactions for an account and date range. No payment or transfer endpoint is available to this MCP.",
      annotations: READ_ONLY,
      inputSchema: z.object({
        accountRef: z.string().min(1),
        from: z.string().min(1).describe("ISO date-time"),
        to: z.string().min(1).describe("ISO date-time"),
        direction: z.enum(["A", "B"]).optional(),
        minAmount: z.number().nonnegative().optional(),
        maxAmount: z.number().nonnegative().optional(),
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().min(1).max(1000).optional()
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

  return server;
}

void serveStdio(createServer);
console.error(`TurkishBankMCP running on stdio (provider=${provider.name}, read-only=true)`);
