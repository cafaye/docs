---
title: billing
description: Plans, subscriptions, prepaid credits, usage metering, and processor webhooks — the money service.
---

`billing` owns money: plans, subscriptions, prepaid credit, usage metering, and
the webhooks that come in from payment processors. It is written in **Ruby**
because it is pure domain modelling — state machines, integers in minor units,
idempotent webhook handlers — and that is Ruby's home turf.

:::caution[Status: v0 — customers and plans]
The schema, the models, the `/v1` API, and a transactional outbox exist and are
tested. **There is no Stripe call anywhere in the repository yet**: the
`processor`, `processor_product_id`, and `processor_price_id` columns are stored
and returned, and all three are null in practice. Subscription state
transitions, checkout and portal sessions, webhook ingestion, and the
usage-events API are later packets.
:::

Money code is held to a stricter bar than the rest of the platform: integer
minor units only — no floats, anywhere — 100% branch coverage on money paths,
idempotency tests for every webhook handler that replay the same event twice,
and state-machine tests covering every subscription transition, legal and
illegal. An `Idempotency-Key` middleware is required on any money-mutating
request, so a client retry cannot charge twice.

Its eventual dependencies are `identity`'s events — a customer and a subscription
have to belong to someone — but today it subscribes to nothing. See
[Contracts](/contracts/) for the manifest that declares this.

- **Repository:** [github.com/cafaye/billing](https://github.com/cafaye/billing)
- **Language:** Ruby
- **Namespace / event source:** `billing`