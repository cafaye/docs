---
title: billing
description: Plans, subscriptions, prepaid credit, usage metering, and payment-processor webhooks — the money service.
---

`billing` owns money: plans, subscriptions, prepaid credit, usage metering, and
the webhooks that come in from payment processors. It is written in **Ruby**
because it is pure domain modelling — state machines, integers in minor units,
idempotent webhook handlers — and that is Ruby's home turf.

:::caution[Status: v0 — customers, plans, subscriptions, and Stripe in both directions]
The schema, the models, the `/v1` API, the transactional outbox, webhook
ingestion from Stripe, **and the subscription lifecycle** are built and tested.
A customer can subscribe, move between plans, and be cancelled, and **this
service now talks to Stripe in exactly three ways**: create a Checkout Session,
cancel a subscription, and move one between plans. Every one of them is a method
on one client, and there is no other `Stripe::` call in the repository — a claim
you check by reading one file rather than by trusting a sentence.

**A subscription's status is never decided by a request.** `POST /v1/subscriptions`
returns a Checkout URL and writes nothing. Cancelling and changing a plan ask the
processor and return the row unchanged. **The row moves when
`customer.subscription.*` arrives**, and the three subscription events are
published in the same transaction as that move.

**Not built:** the customer portal, refunds, proration arithmetic in this service,
and a usage-events API. **And no publisher loop reaches a bus** — events land in
`outbox_events` and are delivered to nobody.
:::

## Money is integers, and the refusals are the feature

`app/models/money.rb` is the seed of the platform-wide rule that money is
**integer minor units** and never a Float. A Float cannot represent `0.10`, so it
never carries an amount. Rounding is never silent, because a rounded price is a
bug that surfaces in somebody's invoice.

```ruby
Money.new(10.5, "USD")            #=> raises Money::InvalidAmountError
Money.from_major("10.505", "USD") #=> raises: would have to round
Money.from_major("10.5", "JPY")   #=> raises: JPY has no minor unit
Money.new(1, "USD") + Money.new(1, "EUR") #=> raises Money::CurrencyMismatchError
Money.new(100, "USD") - Money.new(250, "USD") #=> raises: a negative by subtraction
```

A price crosses the wire as `{"price":{"amount_minor":1900,"currency":"USD"}}`.
`19.00` and `"19.00"` are both `422` — the first has already lost the fact that
it was nineteen dollars exactly, the second would mean this API has two
representations for an amount.

## Three properties that are already load-bearing

**Webhook ingestion is idempotent by construction.** A `UNIQUE` index on
`stripe_event_id` turns a replay into a lookup rather than a second
`billing.payment.succeeded` with a second envelope `id` — which is the only way a
consumer deduplicating on that id can tell a duplicate from new information
about money.

**Out-of-order delivery is handled.** A deletion or an update arriving before its
creation is accepted, and each event keeps its own event time from the payload's
`created` rather than its arrival time. The mapping is therefore derived from
*(did the row exist, what was it, what is it now)* — which is why an `updated`
delivery that turns out to be a cancellation publishes a cancellation.

**`billing.payment.succeeded` has two payload shapes**, because it is emitted
from two sources. Invoice-backed carries `invoice_id` and `subscription_id`;
Checkout-backed carries `checkout_session_id`. Core's schema encodes that as a
`oneOf` so exactly one is present, and a consumer never has to guess which fields
to expect.

:::caution[An open spec disagreement you should know about before you write a consumer]
Core's payload schema for `billing.subscription.started` describes the **old**
shape — the payment processor's `sub_…` id, with `processor` and
`processor_event_id` on every payload. `billing` has since grown a subscriptions
table and moved those three events onto **its own** ids, so it now emits a payload
that core's schema **rejects**: four required fields absent (`processor`,
`processor_event_id`, `kind`, `customer_id`) and four extra fields present
(`plan_id`, `account_id`, `currency`, `started_at`) against a schema closed with
`additionalProperties: false`. The same applies to `billing.subscription.updated`
and `.canceled`, and `billing.plan.created` / `.updated` are missing `entitlements`.

`billing`'s own contract test says this out loud rather than absorbing it, which
is the right call — but it means **there is no schema you can generate a correct
reader from today for those five types.**

**Practical consequence:** if you consume `billing.subscription.*`, read `data` as
**unvalidated** until core's schemas move, and prefer `GET /v1/subscriptions/{id}`
— which has a contract test and a document — over the event payload as your source
of truth. [Upgrading](/upgrading/#2-billingsubscriptionstarted-no-longer-declares-cafaye-prefixed-ids)
has the full note.
:::

## Its dependencies

`billing` subscribes to **no** events yet and declares no service dependencies.
The customers it creates reference `identity`'s users and accounts by uuid, which
is a **data dependency, not a call** — declaring a `dependencies` entry for a
service you never call would tell `caf` to start it for nothing.

`billing.payment.refunded`, `billing.invoice.created`, `billing.usage.recorded`
and `billing.subscription.past_due` are in core's catalog and are **not**
published. Arrears, for instance, are reported as a change to the subscription's
status in `billing.subscription.updated` rather than as a second event; whether a
failed charge is one event or two is a question about what a consumer does with
them, and `billing.payment.failed` already states it.

## Money code is held to a stricter bar than the rest of the platform

Integer minor units only, 100% branch coverage on money paths, idempotency tests
for every webhook handler that replay the same event twice, and state-machine
tests covering every subscription transition, legal and illegal. An
`Idempotency-Key` middleware is required on any money-mutating request, so a
client retry cannot charge twice.

Two comparisons in the plan-change logic are **refused rather than guessed**:
different currencies, because FX is a pricing decision; and different intervals,
because ten dollars a month against a hundred a year is not a cheaper plan, it is
a different unit.

## The gate

```sh
bin/prime        # bundle install, db:prepare, rubocop, rails test
mise run security   # gem audit and Brakeman
```

`bin/prime` prepares the test database itself, so there is no second tier to
miss — but it does need a reachable Postgres. [Running the
gates](/running-the-gates/#billing-and-cafaye-rb--database-in-the-gate-not-outside-it).

- **Repository:** [github.com/cafaye/billing](https://github.com/cafaye/billing)
- **Language:** Ruby
- **Namespace / event source:** `billing` — publishes eight event types
- **Container port:** 80 (3000 in development)
