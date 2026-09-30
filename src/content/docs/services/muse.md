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

:::caution[Status: v1 core — routing, vault, metering, and the only exporter in the fleet]
Provider adapters, the encrypted credentials vault, routing with fallback, token
metering, and the HTTP surface are **done and tested**. `POST /v1/route` serves a
completion from the first candidate provider that works; the vault is AES-256-GCM
under `MUSE_VAULT_KEY` with the provider name as additional authenticated data.

**`muse` is also the only service in the fleet that exports any telemetry** —
traces, and nothing else. It is the reason core's redaction boundary is not
theoretical. Two things follow that are easy to miss:

- **A guard keeps the exporter out of the image.** The OTel exporter is not a
  default dependency, so a build that does not ask for it cannot ship one. That is
  what makes "no exporter in production unless you configure one" a property of
  the dependency graph rather than a promise in a document.
- **`error.type` is not migrated.** `muse` still emits
  `error.type = "ProviderAuthError"` — a per-service exception class name — and
  its own test asserts that exact string. Core is closing the vocabulary into a
  bounded enum; migration is a later packet. **Do not group on `error.type`
  across services yet.** See [Observability](/observability/#errortype).

**Not in this version:** streaming, tool calls, embeddings, images, batches, and
a real admin UI. **Auth is a stub** — the bearer header's presence is checked and
the token is not verified; real JWT verification arrives with the `guard`
contract. And the `muse.tokens.consumed` event it writes to `outbox_events` is
**never published to a bus**, because no service starts a publisher loop.
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