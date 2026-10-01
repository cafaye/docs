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

**`courier` exports traces.** It configures a batch processor over an OTLP
exporter and installs its own span processor, because the Erlang OTel SDK cannot
start one — the module doc carries the reproduction. `COURIER_OTEL_ENDPOINT` is
the whole contract and defaults to the collector that ships with the stack;
`COURIER_TENANT_ID` goes on the **resource**, so it cannot blow the
attribute-combination cap. It exports **traces only**: that SDK has no metrics
API, and kit's collector derives metrics from spans. Its `error.type` is core's
vocabulary, all thirteen. **No collector is deployed in any environment**, so
there is nowhere for the spans to land until you run the stack. See
[Observability](/observability/).
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

:::caution[`docker compose up` does not work in this repository on its own]
`courier/docker-compose.yml` is an **override**, not a stack: it carries the
service, its database name and role, and the crash layer, and deliberately has
**no `image:` on `postgres`** because kit's fetched stack ships that container.
Run alone it stops with
`service "postgres" has neither an image nor a build context specified`.

`courier` ships **`bin/dev`**, which fetches kit's stack at the ref in `kit.ref`
and merges this file beside it:

```sh
bin/dev                             # fetch kit, compose up --wait, migrate, print URLs
curl -s localhost:4000/healthz      # {"status":"ok"}
```

Or run the service on the host against a database you already have —
`mix phx.server`, with `COURIER_SECRET_BOX_KEY` set. Note also that
`docker compose` refuses to interpolate without `COURIER_SECRET_BOX_KEY`, so that
error can be what you see first rather than the missing `postgres` image.

**Three things have to be true before that command does anything, and the second
one is measured rather than documented.** `COURIER_SECRET_BOX_KEY` is
interpolated with `:?`, so compose will not render without it. And
`bin/dev` currently does not finish for this repository, for the reason in
[Getting started](/getting-started/#step-5--run-a-service-locally). Separately,
the **service** also refuses to boot without `COURIER_INBOUND_RESEND_SECRET`,
which `config/runtime.exs` raises on — that is a boot-time refusal rather than an
interpolation one, so it looks different from the other.

The database is `kit`'s container, not `courier`'s: an **override** rather than a
whole stack, so plain `docker compose up` fails with *"service \"postgres\" has
neither an image nor a build context specified"* and `bin/dev` is the command that
composes the two files.
:::

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

Migrations are `mix ecto.migrate`, which is also what `bin/dev` falls back to
here — this repository ships no `bin/migrate`, and `bin/prime` runs `mix
ecto.setup`, which creates *and* migrates in one step. The compose stack has no
migrate service, so on a deploy it is a job.

## The gate

`bin/prime` needs a Postgres it can reach, and **`bin/prime` does not start one
for you**. There is no `db` service in this repository's compose file to start:
the service is called `postgres`, it belongs to `kit`'s stack, and it is
published on `KIT_POSTGRES_PORT` (default `15500`), **not 5432**. So
`docker compose up -d db` cannot resolve on two counts — the service is named
`postgres`, and it belongs to another file.

Bring the stack up, then read the DSN out of the rendered file rather than
assuming a port; `bin/dev stack` prints the merged compose and `bin/dev` prints
the URLs:

```sh
bin/dev                             # bring up kit's stack, including Postgres
mise run prime                      # hex, deps, database, tests
mix precommit                       # warnings-as-errors, unused deps, format, test
```

or set the test DSN to a Postgres you already run. Read the variable names out of
`gate.yml` rather than assuming — the failure mode of guessing is a suite that
passes against the wrong server, and a DSN aimed at a native Postgres on 5432
fails as `role "courier" does not exist`, which reads like a missing migration.

- **Repository:** [github.com/cafaye/courier](https://github.com/cafaye/courier)
- **Language:** Elixir
- **Namespace / event source:** `courier`
- **Container port:** 4000
