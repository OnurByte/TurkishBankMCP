# Security

TurkishBankMCP is intentionally read-only.

## MCP surface

The server does not expose payment initiation, transfer, card-management, consent-deletion or credential-management tools.

The Kobaküs provider only calls `requestMethod=Accounts` and `requestMethod=Transactions`.

The direct ÖHVPS provider only uses account/card information endpoints. Payment initiation endpoints from the wider ÖHVPS standard are outside this project.

## Secrets

- Never commit `.env`, token files, `.secrets/` or `secrets/`.
- `bank_provider_status` only reports whether credentials exist. It never returns secret values.
- Kobaküs passwords can be read from `KOBAKUS_PASSWORD_FILE`.
- ÖHVPS tokens can be read from rotating secret files.
- Request bodies, passwords and access tokens are never included in MCP errors.

## Cache data

Persistent cache is enabled by default at `.data/cache.json`.

The cache can contain account balances and transaction data. Treat it as sensitive financial data. The cache is ignored by Git and TurkishBankMCP tries to write it with `0600` permissions on POSIX systems.

Set `CACHE_FILE=off` if you do not want data persisted to disk.

## Agent boundary

A read-only MCP does not protect secrets from some other tool that has unrestricted shell or filesystem access.

If Hermes or another agent can read every file on the host then it may also be able to read `.env`. Run TurkishBankMCP under a separate OS user or container if you want a harder boundary.

## Production access

For Kobaküs use a separate KWAP service credential. Do not use your normal panel password. Follow Kobaküs IP allow-listing and live onboarding requirements.

For direct ÖHVPS access this repository does not grant YÖS/HBHS status and does not bypass customer consent or BKM/TCMB requirements. Production access must come from an authorized participant or compatible provider.

## Reporting

Do not open a public issue with bank credentials, tokens, IBANs, account data or production request/response payloads.

Remove sensitive values before sharing logs.
