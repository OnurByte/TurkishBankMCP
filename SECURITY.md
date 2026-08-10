# Security

TurkishBankMCP is intentionally read-only.

## No payment surface

The server exposes no payment initiation, transfer, card-management, consent-creation, consent-deletion, or credential-management MCP tools. The initial scope is account/card discovery, balances, transactions, and derived summaries.

## Secrets

- Never commit `.env`; it is ignored by Git.
- Commit only `.env.example` with empty placeholders.
- `bank_provider_status` reports only whether a credential is present, never its value.
- Provider exceptions are sanitized so request headers and tokens are never included in tool output.
- For Hermes, prefer placing long-lived secrets in `~/.hermes/.env` and referencing them from `~/.hermes/config.yaml`, or run the MCP server under an isolated OS/container identity.

## Important threat-model note

MCP tool isolation does not make secrets invisible to an agent that separately has unrestricted shell, process-inspection, or filesystem permissions on the same machine. Treat those Hermes tools and permissions as part of the same security boundary.

## Production ÖHVPS access

Direct production ÖHVPS access is for authorized participants/providers and requires the proper consent/authentication flow. A normal retail bank customer should not expect a personal "API key" from the bank. Use an authorized HBHS/YÖS or compatible aggregator and only grant the account/card information scopes you need.
