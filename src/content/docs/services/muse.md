---
title: muse
description: LLM routing, an encrypted credentials vault, and token metering — one interface over every model provider.
---

`muse` is the platform's route to language models: it picks a provider, holds
their credentials, and meters the tokens so billing has something to bill on. It
is written in **Python** because the routing engine it embeds is LiteLLM, a
Python library — using it natively means one model of the domain (the OpenAI,
Anthropic, and Bedrock request/response shapes) instead of a hand-written port
of it.

:::caution[Status: v1 core — routing, vault, metering, and one of four exporters in
the fleet]
Provider adapters, the encrypted credentials vault, routing with fallback, token
metering, and the HTTP surface are **done and tested**. `POST /v1/route` serves a
completion from the first candidate provider that works; the vault is AES-256-GCM
under `MUSE_VAULT_KEY` with the provider name as additional authenticated data.

**`muse` exports traces, and so do `courier`, `billing` and `identity`.** It was
the first to, which is why it is the reason core's redaction boundary is not
theoretical — and why it is the one a later reader will find an exception in. Two
things follow that are easy to miss:

- **A guard keeps the exporter out of the image.** The OTel exporter is not a
  default dependency, so a build that does not ask for it cannot ship one. That is
  what makes "no exporter in production unless you configure one" a property of
  the dependency graph rather than a promise in a document.
- **`error.type` is not migrated.** `muse` still emits
  `error.type = "ProviderAuthError"` — a per-service exception class name — and
  its own test asserts that exact string. Core is closing the vocabulary into a
  bounded enum; migration is a later packet. `courier` and `identity` already
  carry core's thirteen, so **do not group on `error.type` across all services
  yet** — a panel that is full for two and empty for this one reads as "no
  errors in `muse`", which is the worst possible reading of a real error. Group
  on the span status instead. See [Observability](/observability/#errortype).

**Not in this version:** streaming, tool calls, embeddings, images, batches, and
a real admin UI. And the `muse.tokens.consumed` event it writes to `outbox_events`
is **never published to a bus**, because no service starts a publisher loop.

**This status line said *auth is a stub* until 2026-10-01, and it was wrong by
then.** `muse` verifies the bearer token against `identity`'s published JWKS with
the algorithm **pinned to `RS256` at the decoder** rather than read from the
token, requires `iss`, `aud`, `sub`, `exp`, `iat`, `jti` and `account_id`, checks
the operation's capability separately from the signature, and refuses a token
whose two authorisation claim names disagree. An unreachable key set is a `503`,
never a `401`, and **the service does not serve unauthenticated traffic when
`identity` is down.** `tests/test_auth.py` asserts the token never reaches a log,
a span or an error body. [Security and trust](/security/) carries the measured
detail and the commit, and the [hosted-pilot page](/pilot/) still carries the
older sentence — this repository does not edit that page.
:::

Routing means fallbacks: when one provider is rate-limited or down, `muse` is
expected to answer from another rather than fail the request. Its inter-service
calls follow the platform's bounded-retry rule — a naive retry loop against a
model provider is how a degraded dependency becomes a self-inflicted outage.

Two operational facts about the vault. **The key is never defaulted**:
`MUSE_VAULT_KEY` must be present, must be base64, and must decode to exactly 32
bytes, or the process does not start — a vault that boots with a fallback key is
a vault whose keys are readable by anyone who has read the source. And
**credentials are resolved per call, not cached at construction**, so replacing a
provider key in the vault takes effect on the next request with no restart. What
does *not* work is rotating `MUSE_VAULT_KEY` itself: the `key_version` column
exists and is always `1`, and no tooling is written. See [rotating
secrets](/runbooks/secret-rotation/).

## Running it, and running its gate

```sh
docker compose up --build           # postgres + the service on :8000
MUSE_CORE_SCHEMAS=../core/schemas uv run pytest   # the two core-parity tests
```

`bin/prime` runs `uv sync --locked`, ruff, and pytest under a 100% coverage gate.
It is green without `MUSE_CORE_SCHEMAS`, and that green run has **not** checked
that `muse`'s copied event patterns are still byte-identical to core's schemas —
which is the one check that catches drift between the two repositories. See
[Running the gates](/running-the-gates/#muse--the-core-parity-tests).

- **Repository:** [github.com/cafaye/muse](https://github.com/cafaye/muse)
- **Language:** Python
- **Namespace / event source:** `muse`