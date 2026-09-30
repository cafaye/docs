---
title: billing
description: Plans, subscriptions, prepaid credits, usage metering, and processor webhooks — the money service.
---

`billing` owns money: plans, subscriptions, prepaid credit, usage metering, and
the webhooks that come in from payment processors. It is written in **Ruby**
because it is pure domain modelling — state machines, integers in minor units,
idempotent webhook handlers — and that is Ruby's home turf.

:::caution[Status: v0 — customers, plans, and Stripe webhooks in]
The schema, the models, the `/v1` API, the transactional outbox, and **webhook
ingestion from Stripe** are built and tested. `POST /v1/webhooks/stripe` verifies
the signature against the raw bytes, stores the event once under a UNIQUE
`stripe_event_id`, and turns it into one of this service's own events.

**There is still no outbound Stripe call anywhere in the repository**: the
`processor`, `processor_product_id`, and `processor_price_id` columns are stored
and returned, and all three are null in practice. There is no subscriptions
table, no checkout, no portal, and no usage-events API — those are later packets.
**And no publisher loop runs**: events land in `outbox_events` and are delivered
to nobody.
:::

Money code is held to a stricter bar than the rest of the platform: integer
minor units only — no floats, anywhere — 100% branch coverage on money paths,
idempotency tests for every webhook handler that replay the same event twice,
and state-machine tests covering every subscription transition, legal and
illegal. An `Idempotency-Key` middleware is required on any money-mutating
request, so a client retry cannot charge twice.

Two of those are already load-bearing. `POST /v1/webhooks/stripe` is idempotent
by construction: a `UNIQUE` index on `stripe_event_id` turns a replay into a
lookup rather than a second `billing.payment.succeeded` with a second envelope
`id` — which is the only way a consumer deduplicating on that id can tell a
duplicate from new information about money. And a price crosses the wire as
`{"price":{"amount_minor":1900,"currency":"USD"}}`; `19.00` and `"19.00"` are
both `422`.

Its eventual dependencies are `identity`'s events — a customer and a subscription
have to belong to someone — but today it subscribes to nothing. See
[Contracts](/contracts/) for the manifest that declares this, [billing webhooks
failing](/runbooks/billing-webhooks/) for what to do when a webhook does not
land, and [Topology](/architecture/topology/) for the routes and the four
environment variables it reads.

- **Repository:** [github.com/cafaye/billing](https://github.com/cafaye/billing)
- **Language:** Ruby
- **Namespace / event source:** `billing`