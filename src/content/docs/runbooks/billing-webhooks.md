---
title: Billing Webhooks Failing
description: Inspecting, replaying, and recovering from payment-processor webhook failures — and why a replay is safe.
---

`billing` receives Stripe events at `POST /v1/webhooks/stripe`. This runbook is
for the three states that look the same from the outside and are not the same at
all:

1. **Stripe is not delivering** — no rows in `processor_webhooks`.
2. **Stripe is delivering and `billing` is refusing** — `400` in Stripe's
   dashboard, and *no rows* in the table.
3. **Stripe is delivering and `billing` is storing but not acting** — rows with
   `processed_at` set and an `error` prefix.

Read the status code first. It splits these three immediately.

## The status codes, and what each one means

Every code here is deliberate, and several of them are the opposite of what you
would reflexively expect.

| Code | Means | Rows written? |
| --- | --- | --- |
| **200** | Verified and stored. Whatever became of it. | **yes** |
| **400** | Signature did not verify, or the body is not an event. | **no** |
| **503** | `billing` has no signing secret configured. | **no** |

**A 200 does not mean it worked.** A replay, an unknown type, a deliberately
ignored type, and an event whose mapping raised all answer 200, because each is
recorded and terminal — and a processor retrying any of them reaches the
identical outcome. A 5xx here would teach Stripe to retry a decision `billing`
has already made, and would hide a parked row behind a timeout.

**A 400 wrote nothing.** An unverified payload is not an event, and storing one
would put an attacker's JSON in the row a human reads when something is wrong.
So a signature failure leaves no trace in the database at all — the evidence is
in `billing`'s logs and in Stripe's dashboard.

**A 503 is `billing`'s fault, not Stripe's.** Telling Stripe its signature is
bad when the service cannot check it at all sends an operator looking in exactly
the wrong place. If you see 503, look at your deployment's environment.

:::caution[`400` means you have nothing to replay]
This is the one that catches people. A request refused at the signature is
**not stored**, so once Stripe's retry window closes there is no row to replay
and no payload to re-verify. The only recovery is to fix the secret and let
Stripe resend — see [fixing a signature
failure](#case-2-stripe-is-delivering-and-billing-is-refusing) for how to force
that.
:::

## Step 1 — is anything arriving at all?

```sql
select count(*), min(created_at), max(created_at)
  from processor_webhooks
 where created_at > now() - interval '1 hour';
```

`count = 0` means Stripe is not reaching you. That is a network or DNS problem
before it is a `billing` problem:

```sh
# does the endpoint answer at all?
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BILLING/v1/webhooks/stripe" -d '{}'
```

A `400` here means the endpoint is up and configured (an unsigned request is
correctly refused). A `503` means it is up and **unconfigured**. A connection
error means the path, the port, or the TLS termination is wrong.

## Step 2 — what arrived, and what happened to it

```sql
select stripe_event_id,
       type,
       created_at,
       processed_at,
       left(coalesce(error, ''), 120) as error
  from processor_webhooks
 order by created_at desc
 limit 20;
```

`error` is a terminal outcome, not an error in the HTTP sense. Two prefixes, and
they mean different things:

| `error` prefix | Meaning | Fix |
| --- | --- | --- |
| *(empty, `processed_at` set)* | Handled. An event was emitted. | nothing |
| `ignored: …` | Understood and deliberately not acted on. | usually nothing — see below |
| `failed: …` | Parked for a human. | **this one needs you** |

`ignored:` is correct behaviour for several real cases, and treating it as a
failure is how a healthy service generates work:

- `ignored: connectivity_check` — Stripe's `ping`. Signed and real, and not a
  business fact. The row is kept on purpose, because "the processor is talking
  to us and we are not acting on it" is worth being able to query.
- `ignored: unhandled_event_type` — a type nobody has written a mapping for.
  **This one is a real gap, and it is different from a deliberate ignore.** If
  you are seeing it for `invoice.payment_succeeded` or any type you expect to
  act on, a mapping is missing.
- A **subscription-mode Checkout session** is deliberately ignored. It restates
  `customer.subscription.created`, and acting on it would count every Checkout
  signup twice.

## Case 1 — Stripe is not delivering

Not `billing`'s problem. Check, in order:

1. **The endpoint URL** in the Stripe dashboard resolves and terminates TLS.
   The services bind plain HTTP; TLS is the edge's job — and in a Kamal
   deployment `proxy.ssl: true` in `config/deploy.yml` is what terminates it.
2. **The endpoint is enabled** in Stripe, and pointed at the environment you
   think it is. Staging and production endpoints are separate objects.
3. **`STRIPE_WEBHOOK_SECRET` matches.** See case 2.
4. **Firewall / security group, and the port the image is actually on.** `billing`
   listens on **3000** under the local stack and **80** in the container image —
   its `Dockerfile` declares `EXPOSE 80`, and the local compose file overrides
   the environment with `PORT: "3000"` and publishes `3000:3000`. So which port
   your firewall needs depends on how you are running it, and the answer is not
   the same in both.

:::caution[Scope: `billing` is not in launch scope, and this page is written against a stack nobody has deployed]
Everything here describes code that exists and is tested. **It is not a
description of a running deployment**, for two reasons worth keeping separate:

- **`billing` is out of launch scope.** A page that reads like an operator's
  reference for a service that is not shipping is how a confident-but-wrong
  document gets written, so the status line is here rather than implied.
- **No repository has adopted kit's Kamal configuration as a deployment.**
  `kit/templates/kamal/` ships `deploy.yml.erb`, `kamal-backup.yml.erb` and
  `drill.sh`; **`identity` and `courier` have adopted both `config/deploy.yml`
  and `config/kamal-backup.yml`** — as of 2026-10-01, and both changed the
  template's `/up` proxy healthcheck to `/readyz` while they were there. What is
  adopted **as a deployment** is nothing: `bin/drill` exists nowhere in the
  fleet, and `billing`'s `config/deploy.yml` is the stock Rails-generated file
  from its first commit with the whole `proxy:` block commented out. There is
  therefore no accessory, no published port and no TLS termination story to check
  against — which is why step 1 above is written as "does the endpoint answer at
  all" rather than as a recipe against a known topology. See [backup and
  restore](/runbooks/backup-and-restore/) for the measured version of that gap.

What that means for you, concretely: the SQL and the status-code table are
verified against the code and will hold. The **network path** — ports, firewall,
TLS — is the part you are inventing, and this page cannot tell you what it
should be.
:::

## Case 2 — Stripe is delivering and `billing` is refusing (400)

There is no row. The evidence is in the logs, and it is deliberately specific:

```
stripe webhook rejected: UnverifiedSignature: no configured secret verified the signature
stripe webhook rejected: MalformedEvent: verified body is not an event
```

Four causes, in the order they are worth checking:

**The secret is wrong or was rotated on one side only.** This is the common one.
Check whether `STRIPE_WEBHOOK_SECRET` still matches the endpoint's current
secret. The fix is the overlap procedure in [rotating
secrets](/runbooks/secret-rotation/) — **put both secrets in
`STRIPE_WEBHOOK_SECRETS` before you touch Stripe**, because every event during
the mismatch is a permanent loss once the retry window closes.

**The clock is wrong.** The signature covers a timestamp, and the default
tolerance is `STRIPE_WEBHOOK_TOLERANCE=300` seconds. More than five minutes of
skew rejects every event. Compare the host clock against NTP.

**A proxy rewrote the body.** The signature is checked against the **raw bytes**,
never a re-serialized parse. A proxy that pretty-prints JSON, re-encodes it, or
strips a trailing newline invalidates a signature that was correct when Stripe
sent it. If a load balancer or WAF sits in front of `billing`, this is the cause.

**The tolerance is being defeated by a very old delivery.** A capture is
replayable only inside the window. If the skew is genuinely large, raise
`STRIPE_WEBHOOK_TOLERANCE` deliberately rather than disabling the check.

### Recovering the lost events

You cannot replay from the database, because nothing was stored. Your options:

1. **Fix the secret, then ask Stripe to resend.** The Stripe dashboard's
   endpoint page can resend an event, and `ping` events are a cheap way to
   confirm the signature verifies before you trust a resend of a real one.
2. **For events inside the retry window, do nothing** — Stripe is still
   retrying and will succeed once the secret is right.
3. **For events past the retry window, reconcile by hand.** Read the event out of
   the Stripe dashboard and record what happened in your own ledger, and treat the
   gap as a manual correction rather than pretending it was ingested.

:::caution[`billing` now calls Stripe as well as receiving from it]
This section used to say `billing` receives and never calls. It no longer does: a
subscription is bought through a Checkout Session, cancelled by asking Stripe to
cancel, and moved between plans by asking Stripe to move it. That means a Stripe
**API** key exists and it is part of your configuration, alongside the webhook
signing secret — and **they are rotated differently.** The webhook secret has a
zero-downtime overlap (`STRIPE_WEBHOOK_SECRETS`); the API key does not, because
there is only ever one. See [rotating
secrets](/runbooks/secret-rotation/#the-inventory).
:::

## Case 3 — rows exist with `failed:` (parked for a human)

```sql
select stripe_event_id, type, created_at, error
  from processor_webhooks
 where error like 'failed:%'
 order by created_at desc;
```

The error is the class and message from the mapping. The three properties of
the ingestion layer tell you what you are looking at:

- The payload was **verified and stored first**, so whatever you need is on the
  row in the `payload` column.
- The `failed:` outcome is **recorded and the request answered 200**. Stripe
  will not retry, and it should not: a retry reaches the identical outcome.
- The outbox row and the `processed_at` are written in **one transaction**, so a
  `failed:` row has no outbox row beside it. There is no half-emitted event to
  clean up.

Common causes: a payload shape Stripe changed, or a mapping that assumed a field
is present when it is not. `billing` refuses rather than defaulting — a field the
processor did not send is absent from the normalized hash rather than filled
with a guess, because a silently-filled gap is how a customer ends up on a plan
nobody charged them for.

## Replay — and why it is safe

**Replaying a `billing` webhook is safe by construction, and that is a design
property rather than a promise.**

`stripe_event_id` carries a **UNIQUE index**. `ProcessorWebhook.ingest` does a
`find_or_create_by!` on it, and the unique constraint is what settles the race
when two deliveries of the same id both miss the read — the loser gets the
winner's row back instead of raising. So:

- The second arrival of an event id **finds the existing row**.
- `handled?` is true, so `dispatch` never runs.
- **No second `billing.payment.succeeded`, and therefore no second envelope
  `id`.**

That last point is the one that matters. A consumer deduplicating on the
envelope `id` cannot tell a second emission from new information about money, so
"at most once per processor event id" is the property the whole design is
protecting. It is also why an envelope `id` is generated before the outbox insert
and reused on every retry: a republish carries the same id, which is the only
reason the consumer's dedupe key works at all.

A replayed event answers **200 with the same response as the first delivery** —
a replay carries no different outcome, so there is nothing to signal.

### How to replay

Use Stripe's own resend, in this order:

1. **Fix the cause first.** A replay of a `failed:` event re-runs the same
   mapping and reaches the same `failed:`. Read the `error`, fix the mapping or
   the configuration, and only then replay.
2. Resend the single event from the Stripe dashboard.
3. Confirm the row moved:

```sql
select stripe_event_id, processed_at, error
  from processor_webhooks
 where stripe_event_id = 'evt_…';
```

`processed_at` now set and `error` empty means it was handled.

**Do not re-`POST` a payload you copied out of the `payload` column.** The
signature covers the raw bytes and the timestamp, and a re-serialized body will
not verify — you will get a `400` and store nothing. Replay through Stripe,
which re-signs.

**Do not "fix" a `failed:` row by clearing `error` or setting `processed_at`.**
You would be asserting a money event happened that this service never emitted,
and nothing downstream would ever know the difference.

## Then check the outbox

An event that was handled is on `outbox_events`:

```sql
select event_type, subject, time, published_at is null as unpublished, attempts
  from outbox_events
 order by created_at desc
 limit 20;
```

`billing` declares the full `core` column contract here: `event_type`, `source`,
`subject`, `time`, `data`, `created_at`, `published_at`, `attempts`, with a
partial index on the unpublished rows.

**`unpublished: t` on every row is expected today.** `billing` has no publisher
loop; nothing publishes `outbox_events` to a broker. So a handled webhook means
"the row exists and the event was recorded", not "a consumer was told". See
[architecture](/architecture/#the-write-path-in-full).

Two useful queries while you are here:

```sql
-- events stuck for a human, by type
select type, count(*) from processor_webhooks
 where error like 'ignored:unhandled_event_type%'
 group by type order by 2 desc;

-- how much has arrived and how much was acted on, today
select count(*) filter (where processed_at is not null) as handled,
       count(*) filter (where error like 'ignored:%')  as ignored,
       count(*) filter (where error like 'failed:%')  as failed,
       count(*) filter (where processed_at is null)   as unprocessed
  from processor_webhooks
 where created_at > now() - interval '24 hours';
```

`unprocessed` (with `processed_at` null and no error) is the number to watch: a
row in that state is a delivery that arrived and was never finished, and it
should be zero. There is a partial index on it —
`processor_webhooks_unprocessed_idx` — precisely so that query is cheap.

## The mapping, so you know what should have happened

Verified Stripe type → `billing` event. This is the complete set; anything else
is `ignored: unhandled_event_type`.

| Stripe event | `billing` event |
| --- | --- |
| `customer.subscription.created` | `billing.subscription.started` |
| `customer.subscription.updated` | `billing.subscription.updated` |
| `customer.subscription.deleted` | `billing.subscription.canceled` |
| `invoice.paid` | `billing.payment.succeeded` |
| `invoice.payment_failed` | `billing.payment.failed` |
| `checkout.session.completed` (payment mode) | `billing.payment.succeeded` |
| `checkout.session.completed` (subscription mode) | *nothing, deliberately* |
| `ping` | *nothing, `ignored: connectivity_check`* |

`subject` is the entity the event is about, and **what it is depends on the
event**, which is the thing a consumer is most likely to get wrong here:

| Event | `subject` |
| --- | --- |
| `billing.subscription.started` / `.updated` / `.canceled` | **billing's own `Subscription#id`** — a cafaye id, so all three join on one key with no lookup table |
| `billing.payment.succeeded` / `.failed` | the processor's id, because an invoice references a subscription rather than being one, and the join key is the processor's subscription id in the payload |

`billing` has a subscriptions table, so a subscription event's subject is a
cafaye id and the three events correlate on it directly. The payment events keep
the processor's id, and the payload carries the processor's subscription id you
need to join them.

:::caution[Do not validate a subscription event's `data` against core's schema yet]
`billing` emits `subscription_id` as its own id, beside `plan_id`, `account_id`,
`currency` and `started_at`. **Core's schemas describe the pre-table shape** — the
processor's `sub_…`, plus required `processor`, `processor_event_id`, `kind` and
`customer_id`, closed with `additionalProperties: false`. A reader generated from
either version rejects the real payload.

**Prefer `GET /v1/subscriptions/{id}`**, which has a contract test and an
OpenAPI document, over the event payload as your source of truth until core's
schemas move. [Upgrading](/upgrading/#2-billingsubscriptionstarted-no-longer-declares-cafaye-prefixed-ids)
has the full note.
:::

Out-of-order delivery is handled: a deletion or an update arriving before its
creation is accepted, and each event keeps its own event time from the payload's
`created` rather than the arrival time. The mapping is derived from *(did the row
exist, what was it, what is it now)*, so an `updated` delivery that turns out to
be a cancellation publishes a cancellation.

**One charge can produce two `payment.succeeded` events.** A one-time Checkout
payment is not ignored the way a subscription-mode Checkout session is, and the
invoice it creates settles too. A consumer that counts settled payments has to
decide whether that is one payment or two — it is a real question about your
consumer, and `billing` deliberately does not suppress the invoice event, because
suppressing it is a revenue-path decision.

## What not to do

- **Do not disable signature verification to stop the 400s.** You are accepting
  unauthenticated JSON that writes rows a human reads.
- **Do not raise the tolerance to a very large number** to work around clock
  skew. Fix the clock.
- **Do not hand-insert an `outbox_events` row** to make a payment event appear
  to have happened. It has no envelope `id` a consumer can dedupe on, and it is a
  fabricated record of money.
- **Do not treat a 200 as success.** A parked `failed:` row is a 200.
- **Do not replay through `curl`.** A re-serialized body will not verify.
- **Do not delete `processor_webhooks` rows to make a report look clean.** That
  table is the audit trail of what a processor told you, and the UNIQUE index on
  `stripe_event_id` is what makes a replay safe. Removing rows removes both.

## See also

- [Rotating secrets](/runbooks/secret-rotation/) — the `STRIPE_WEBHOOK_SECRETS`
  overlap that prevents case 2 entirely.
- [A service is down](/runbooks/service-down/) — if the endpoint is not
  answering at all.
- [Backup and restore](/runbooks/backup-and-restore/) — `processor_webhooks` is
  worth backing up for the same reason a ledger is.
