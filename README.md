# TurkishBankMCP

Read-only MCP server for Turkish Open Banking (**ÖHVPS**) financial data. It is designed for agent hosts such as **Hermes Agent** to inspect accounts, balances, incoming/outgoing transfers, card movements and cash-flow summaries without exposing payment or transfer actions.

> Target: **ÖHVPS 2.0.0**, the active v2 specification as of 2026-08-10. The project intentionally does not target the 2.0.1 draft until it becomes active.

## Why this architecture?

ÖHVPS is the bank/open-banking protocol. MCP is the agent-facing tool protocol. TurkishBankMCP sits between them:

```text
Turkish bank / ÖHVPS-compatible provider
                  │
                  ▼
          ÖHVPS 2.0.0 REST
                  │
                  ▼
            TurkishBankMCP
                  │
             MCP over stdio
                  │
                  ▼
             Hermes Agent
```

The MCP server is deliberately **read-only**. There are no payment-initiation, transfer, consent-deletion or card-management tools.

## Current tools

| Tool | Purpose |
| --- | --- |
| `bank_provider_status` | Configuration/capability status; never returns secret values |
| `bank_list_accounts` | Accounts under the active consent |
| `bank_get_balances` | Current balances |
| `bank_list_transactions` | Raw account movements |
| `bank_monthly_cashflow` | Incoming / outgoing / net cashflow by currency |
| `bank_list_cards` | Cards under the active consent |
| `bank_list_card_transactions` | Raw card movements |
| `bank_card_spending_summary` | Card spend / credits / net spend by currency |

## ÖHVPS 2.0.0 mapping

The live provider uses these account/card information resources:

```text
GET /hesaplar
GET /bakiye
GET /hesaplar/{hspRef}/islemler
GET /kartlar
GET /kartlar/{kartRef}/kart-hareketleri
```

The adapter sends the participant bearer credential in `Authorization`, the customer-consent resource credential in `X-Access-Token`, participant codes, request/group IDs and `PSU-Initiated` (`E` for user-triggered, `H` for system-triggered).

### Conservative caching

The minimum supported individual call limits in ÖHVPS 2.0.0 are finite, so the live adapter caches reads conservatively in memory:

- accounts: 6h
- balances: 1h
- account transactions: 6h per query
- cards: 6h
- card movements: 45m per query

This reduces accidental repeated calls from an agent. It is **not** a replacement for a persistent ledger/sync worker; that is the next architectural layer if long-term analytics are needed.

## Requirements

- Node.js 20+
- For local development: no banking credentials are needed (`BANK_PROVIDER=mock`)
- For live data: valid credentials/consent from an authorized ÖHVPS HBHS/YÖS or compatible aggregator/provider

A retail Garanti BBVA (or other bank) customer normally does **not** receive a simple personal ÖHVPS API key. Production account-data access is a regulated provider/consent flow.

## Setup

```bash
git clone git@github.com:OnurByte/TurkishBankMCP.git
cd TurkishBankMCP
npm install
cp .env.example .env
npm run build
npm run inspect
```

The default `.env.example` uses the safe mock provider. Try the MCP Inspector first, then switch to a live provider only after you have valid credentials.

## `.env`

```dotenv
BANK_PROVIDER=ohvps
OHVPS_SPEC_VERSION=2.0.0
OHVPS_BASE_URL=https://your-authorized-provider.example/ohvps/hbh/s2.0
OHVPS_TPP_CODE=...
OHVPS_ASPSP_CODE=...
OHVPS_GATEWAY_TOKEN=...
OHVPS_ACCESS_TOKEN=...
OHVPS_GROUP_ID=
OHVPS_PSU_FRAUD_CHECK=
HTTP_TIMEOUT_MS=12000
```

`.env` is ignored by Git. Never put real secrets in `.env.example`.

## Hermes Agent

Hermes supports local stdio MCP servers in `~/.hermes/config.yaml` under `mcp_servers`.

### Option A — TurkishBankMCP reads its own `.env`

Build the project and add:

```yaml
mcp_servers:
  turkish_bank:
    command: "node"
    args: ["/absolute/path/to/TurkishBankMCP/dist/index.js"]
    tools:
      include:
        - bank_provider_status
        - bank_list_accounts
        - bank_get_balances
        - bank_list_transactions
        - bank_monthly_cashflow
        - bank_list_cards
        - bank_list_card_transactions
        - bank_card_spending_summary
```

`src/config.ts` resolves `.env` relative to the project, so Hermes does not need to receive those values as MCP arguments.

### Option B — keep secrets in Hermes' secret env

Put values in `~/.hermes/.env`, then pass only environment references in `config.yaml`:

```yaml
mcp_servers:
  turkish_bank:
    command: "node"
    args: ["/absolute/path/to/TurkishBankMCP/dist/index.js"]
    env:
      BANK_PROVIDER: "ohvps"
      OHVPS_BASE_URL: "${OHVPS_BASE_URL}"
      OHVPS_TPP_CODE: "${OHVPS_TPP_CODE}"
      OHVPS_ASPSP_CODE: "${OHVPS_ASPSP_CODE}"
      OHVPS_GATEWAY_TOKEN: "${OHVPS_GATEWAY_TOKEN}"
      OHVPS_ACCESS_TOKEN: "${OHVPS_ACCESS_TOKEN}"
```

Hermes discovers the MCP tools; it does not need a tool that prints the credential. Note that if Hermes separately has unrestricted shell/filesystem access on the same host, that broader permission is part of your security boundary.

## Mock examples

With `BANK_PROVIDER=mock`, Hermes can already ask:

- "Banka hesaplarımı ve bakiyelerimi göster."
- "Ağustos hesabıma ne kadar para girmiş ve çıkmış?"
- "Kart dönemindeki toplam harcamayı çıkar."
- "Kart hareketlerini inceleyip muhtemel abonelikleri bul."

Subscription detection is intentionally left to Hermes/your analysis layer for now; the MCP server returns clean card movement descriptions and amounts and provides deterministic totals.

## What is not implemented yet?

- Consent creation/GKD browser flow
- Automatic refresh-token lifecycle
- JWS signing for consent/token endpoints
- Persistent SQLite/Postgres ledger
- Scheduled incremental sync
- Multi-bank aggregator adapters beyond generic ÖHVPS
- Subscription recurrence engine

These are separate from the read-only MCP surface and can be added without changing Hermes prompts/tool names.

## Security

See [SECURITY.md](SECURITY.md). The short version: no payment tools, no secret-returning tools, `.env` is gitignored, and production access should use least-privilege account/card-information consent only.

## References

- ÖHVPS official documentation: `https://ohvps.github.io/v2.0.0/`
- Model Context Protocol: `https://modelcontextprotocol.io/`
- Hermes Agent MCP docs: `https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/mcp.md`
