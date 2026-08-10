# Security

TurkishBankMCP is intentionally read-only.

## MCP surface

The server does not expose payment initiation, transfer, card-management, consent-deletion or credential-management tools. Only account/card information reads and deterministic summaries are exposed.

The underlying ÖHVPS standard also defines payment services. Those endpoints are intentionally outside this project.

## Secrets

- Never commit `.env`, token files, `.secrets/` or `secrets/`.
- `bank_provider_status` reports only whether credentials are configured; it never returns their values.
- Token file paths can be used when an external auth/gateway process rotates credentials.
- Provider errors are reduced to status/error-code/public detail; request headers and tokens are not returned to the MCP client.

## Cache data

Persistent cache is enabled by default at `.data/cache.json` to protect ÖHVPS request limits across MCP process restarts.

The cache may contain account, balance, transaction and card data. Treat it as sensitive financial data. TurkishBankMCP writes the cache with `0600` permissions where the platform supports POSIX permissions. The `.data/` directory is ignored by Git.

Set `CACHE_FILE=off` if you do not want data persisted to disk.

## Agent boundary

Read-only MCP tools do not make credentials invisible to an agent that separately has unrestricted shell, filesystem, process-inspection or container-host access. Run the MCP under a dedicated OS/container identity if the rest of the agent has broad local permissions.

## Production ÖHVPS access

This repository does not grant YÖS/HBHS status, perform BKM technical certification or bypass customer consent/GKD requirements. Production access must come from an authorized ÖHVPS participant or compatible aggregator/provider.

Only grant the account/card-information permissions required for your use case.

## Reporting

Do not open a public issue containing bank credentials, access tokens, account data or production request/response payloads. Remove sensitive values before sharing logs or examples.
