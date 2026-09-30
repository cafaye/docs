---
title: courier
description: Transactional email, push, and every outbound webhook — signed over the Standard Webhooks spec, retried, at-least-once.
---

`courier` is the service the platform talks *out* through: transactional email,
push notifications, notification preferences, and **every outbound webhook** — so
it carries the **Standard Webhooks** spec exactly (a `webhook-id`, a timestamp,
and an HMAC-SHA256 signature header, no scheme of our own), and it defends
itself against the SSRF that customer-supplied webhook URLs invite. It is
written in **Elixir** because fanning out to thousands of providers
concurrently is exactly what the BEAM is for.

:::caution[Status: v0 — the email pipeline and outbound webhooks are built]
The Swoosh email pipeline, the notification-preference store, the Oban-backed
outbox worker, and the outbound webhook pipeline (endpoints, sealed secrets,
signed dispatch, delivery records, a retry budget and a circuit breaker) are all
**built and tested**. There is an `openapi.yaml`, six migrations, a release image
and a compose stack.

**`courier` publishes exactly one event today: `courier.email.delivered`,** written
to `outbox_events` in the same transaction as the send and relayed by the Oban
worker. The other four types it declares are declared-and-not-yet-emitted — a
catalog entry is a promise, not a claim — and `email.bounced` / `email.complained`
need a provider webhook, which is a later packet.

**And no publisher loop reaches a bus.** `courier`'s Oban worker relays to the
outbox path; there is no broker in the platform, so a recorded event is still a
row. See [Topology](/architecture/topology/#what-is-not-wired-yet).
:::

## The event types changed, and that is the part a consumer has to know

`core` froze the grammar as `<service>.<entity>.<action>` — three segments,
prefixed with the publisher's own name. `courier` shipped two-segment types,
which fail that pattern; it has been corrected:

| Was | Is now |
| --- | --- |
| `email.queued` | `courier.email.queued` |
| `email.delivered` | `courier.email.delivered` |
| `email.bounced` | `courier.email.bounced` |
| `email.complained` | `courier.email.complained` |
| `notification.suppressed` | `courier.notification.suppressed` |

**This changes the `type` on events already on the bus.** If you have written a
consumer against `email.delivered`, it is now matching a type nobody publishes,
and it will stop being called with no error. [Upgrading](/upgrading/) has the
order to fix it in — widen the consumer to accept both spellings before the
producer is cut over.

## Outbound webhooks

`courier` owns every outbound webhook on the platform, so a subscriber does not
implement signature verification, retry, or backoff:

- **Signatures are the Standard Webhooks spec**, verified with the official
  libraries rather than a hand-rolled check. A `webhook-id`, a timestamp and an
  HMAC signature header, so a receiver written against any other Standard Webhooks
  implementation works here unchanged.
- **A retry budget**, not an unbounded loop: every attempt is bounded and every
  exhaustion is recorded.
- **A circuit breaker**, so a subscriber that is down stops consuming the queue
  rather than turning one dead endpoint into a self-inflicted outage.
- **An SSRF guard on customer-supplied URLs**, because a webhook endpoint is a
  URL a tenant chooses and the service is the one that dials it.

**Delivery is at-least-once**, which makes idempotency the consumer's problem
rather than the sender's: `courier` is expected to deliver the same payload twice
under a failure, and every consumer of its events has to tolerate that. Dedupe on
the envelope `id` with a unique constraint, in the same transaction as your work.

## Running it

```sh
docker compose up --build           # postgres:17 + the release image
curl -s localhost:4000/healthz      # {"status":"ok"}
```

| Probe | Meaning | 503 body |
| --- | --- | --- |
| `/healthz` | liveness — never touches the database | never |
| `/readyz` | readiness — really checks | `{"status":"error","checks":{"database":"unavailable"}}` |

Both sit at the root, outside `/api`, and both are exempt from the production SSL
redirect: an orchestrator that gets a `301` to https from `/healthz` reads
`courier` as dead.

**Set your probe timeout above 5 seconds.** With a database gone underneath a
running pool, `/readyz` takes about **4.4 seconds** to answer 503 — the pool's
queue backpressure, not the query timeout. An orchestrator with a shorter timeout
times out and reaches the same verdict the slower way, which is to restart a
service that is answering correctly.

Migrations run through `bin/migrate`, which is `Courier.Release.migrate/0`. The
compose stack has no migrate service yet, so run it as a deploy job.

## The gate

`bin/prime` needs a Postgres at `localhost:5432` as `postgres`/`postgres`:

```sh
docker compose up -d db
mise run prime        # hex, deps, database, tests
mix precommit         # warnings-as-errors, unused deps, format, test
```

- **Repository:** [github.com/cafaye/courier](https://github.com/cafaye/courier)
- **Language:** Elixir
- **Namespace / event source:** `courier`
- **Container port:** 4000
