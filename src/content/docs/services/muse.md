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

:::caution[Status: v0 scaffold]
A service skeleton: an app factory, health probes, a test harness, and a
container build. **No LLM logic yet** — no provider adapters, no credentials
vault, no routing or fallback, no metering. Provider adapters and the encrypted
vault come first; metering is last, and when it lands it publishes usage events
for `billing` to consume.
:::

Routing means fallbacks: when one provider is rate-limited or down, `muse` is
expected to answer from another rather than fail the request. Its inter-service
calls follow the platform's bounded-retry rule — a naive retry loop against a
model provider is how a degraded dependency becomes a self-inflicted outage.

- **Repository:** [github.com/cafaye/muse](https://github.com/cafaye/muse)
- **Language:** Python
- **Namespace / event source:** `muse`