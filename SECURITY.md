# Security

TurkishBankMCP is intentionally read-only

The runtime only exposes Garanti Account Information and Account Transactions access

There are no payment transfer EFT card management purchase or credential management MCP tools

## Garanti app permissions

Create a dedicated Garanti Developer Portal application for TurkishBankMCP

Subscribe that application only to

- Account Information
- Account Transactions

Do not add Bulk Transfer Direct Collection Account Payment or other write capable products to the same application

This is the strongest production boundary because the OAuth credential itself is limited to the two read-only products

## Endpoint guard

The configured account endpoints must use HTTPS

TurkishBankMCP also refuses configured endpoint URLs containing obvious write-capable terms such as transfer payment EFT direct collection loan or card management

This denylist is defense in depth and does not replace correct Garanti application permissions

## Secrets

Never commit `.env` `.secrets` or production payloads

`GARANTI_CLIENT_SECRET_FILE` can be used instead of putting the client secret directly in `.env`

The access token is held in memory and refreshed automatically

Neither client secret nor access token is returned by MCP tools

Authorization headers are not accepted through `GARANTI_EXTRA_HEADERS_JSON` so they cannot override the provider OAuth flow

## Errors

Errors only return a short public message from the provider when available

Request headers client secrets and access tokens are not included in MCP errors

429 and temporary 5xx responses use bounded retry behavior

A 401 invalidates the cached token and performs one token refresh

## Agent boundary

Read-only MCP permissions do not restrict some other tool that has unrestricted shell filesystem or process access

If the agent can read every file on the machine then it may also be able to read `.env` or `.secrets`

Use a separate OS user or container when you need a harder boundary

## Reporting

Do not put client credentials tokens IBANs account numbers or real bank payloads in public issues

Sanitize logs and examples before sharing them
