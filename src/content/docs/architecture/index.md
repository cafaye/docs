---
title: Architecture
description: What each cafaye service owns, how they talk, and why the boundaries are where they are.
---

cafaye is an **organization, not a repository**. Seven services, each in its own
repo, each in the language its job fits, each owning its own database. They are
connected by typed contracts — a versioned `cafaye.yml` manifest, OpenAPI
documents, and an event envelope — and never by shared code.

This page is the map. [Topology](/architecture/topology/) is the same thing as an
operator's table: ports, probes, environment variables, the HTTP surface of each
service, and the drift audit. [Contracts](/contracts/) is the specification of
the wire formats, and [Observability](/observability/) is the third of the three
mechanisms — what a service is allowed to record about what it did.

## The services, and what each one owns

Ownership is the whole design. A capability lives in exactly one service, and
every other service reaches it over a contract rather than reaching into its
database.

| Service | Owns | Language | Reached by |
| --- | --- | --- | --- |
| [`identity`](https://github.com/cafaye/identity) | Users, sessions, accounts and tenancy, roles, invitations, OIDC, MFA | Go | HTTP `/v1/*`; verified by `guard` |
| [`billing`](https://github.com/cafaye/billing) | Plans, customers, money, usage metering, payment-processor webhooks in | Ruby | HTTP `/v1/*`; a Stripe-signed webhook endpoint |
| [`courier`](https://github.com/cafaye/courier) | Transactional email, push, notification preferences, **every outbound webhook** | Elixir | HTTP; plus events every other service publishes to it |
| [`darkroom`](https://github.com/cafaye/darkroom) | Media: uploads, variants, object storage | Rust | HTTP + presigned object-storage URLs |
| [`muse`](https://github.com/cafaye/muse) | LLM routing, the provider-credentials vault, token metering | Python | HTTP `POST /v1/route` |
| [`guard`](https://github.com/cafaye/guard) | The public edge: token verification, the browser session, rate limits | TypeScript | HTTP — **it is the door; nothing else is public** |
| [`parlor`](https://github.com/cafaye/parlor) | The app shell you clone, plus the admin surface | Next.js | A browser |

Two boundaries do most of the work.

**`identity` owns the question "who is this, and what may they do".** It is the
only service that holds credential material and the only one that knows what a
role means. Everything else asks it, and none of them keeps its own copy of the
answer.

**`billing` owns the question "what does this cost, and did they pay".** It is
the only service that holds money state. `parlor` never talks to Stripe; `muse`
never decides what a token is worth; both produce facts that `billing` turns
into an invoice.

## How they talk: two mechanisms, not one

### HTTP, for questions

Synchronous. A caller asks a service something and needs the answer in the same
request: register a user, mint a session, list plans, resolve a model, fetch a
key set.

Each service that serves traffic publishes an OpenAPI 3.1 document at the path
its `cafaye.yml` `exposes.api` names, and validates its own responses against
it in CI. The conventions — the `application/problem+json` error envelope,
cursor pagination, `Idempotency-Key`, `traceparent` propagation — are in
[`core/docs/openapi-conventions.md`](https://github.com/cafaye/core/blob/master/docs/openapi-conventions.md).
`core` owns them; this site summarizes.

**Never a service-to-service database read.** Each service has its own database
and there are no cross-database foreign keys. `billing`'s customers reference
`identity`'s users and accounts by UUID. That reference is a data dependency,
not a call, and `billing` is careful to say so in its manifest: declaring a
`dependencies` entry for a service you never call would make a tool start it for
nothing.

### Events, for facts

Asynchronous. Something happened; other services may care. The unit is the
envelope in `core/schemas/event-envelope.schema.json`, whose `data` is
validated against a per-type payload schema before it is written.

Event types are always `<service>.<entity>.<action>` — three segments, always
prefixed with the publisher's own name, no exceptions. `identity.user.created`
is legal in `identity` and a bug anywhere else. The rule exists because the
prefix is what makes a topic self-describing: a consumer reading
`billing.payment.succeeded` knows who to blame without a lookup table.

Delivery is **at-least-once**, and `core` is explicit that it cannot promise
more without a distributed transaction between a service's database and the
broker. So:

- A consumer that is not idempotent is broken, and **it will not fail in
  testing** — the duplicate shows up as a slow crash at 3am.
- Every consumer dedupes on the envelope `id` with a **unique constraint**,
  inserted in the same transaction as its own work. An in-memory "have I seen
  this?" set is wrong the moment there are two replicas.
- Ordering is per-`subject`, not global. Correlate on `subject` and compare
  `time` before acting on anything order-dependent.

**The state of the bus today is the important caveat.** `identity` and `billing`
both write `outbox_events` correctly, in the same transaction as the domain
change. **Neither starts a publisher loop.** `identity`'s only `Publisher`
implementation is a deliberate no-op — starting it would mark every event
published and drain the outbox into nowhere. Events are recorded and stay in the
table. Treat every cross-service reaction as something you have to build
yourself for now.

## The write path, in full

This is the shape `core` specifies and `identity` and `billing` implement. It is
worth understanding once, because it explains several failure modes that are
otherwise baffling.

```
client ──POST /v1/…──▶ service
                        │
                        ├─ begin
                        ├─ insert the domain row          (users, plans, …)
                        ├─ insert into outbox_events      (id generated NOW)
                        └─ commit ──▶ 201 Created
                                              │
                            publisher loop ───┘   (separate process)
                                 │  select … where published_at is null
                                 │  order by created_at
                                 │  limit $1 for update skip locked
                                 ▼
                              broker ──▶ consumer (dedupes on id)
```

Three properties fall out of that diagram, and all three are load-bearing:

**The write and the event commit or roll back together.** There is no window in
which the database says something happened and the event does not exist. This is
why publishing "after commit" from an in-memory queue is the same bug with a
nicer syntax.

**The `id` is generated before the insert, and reused on every retry.** A row
that is published, fails to be marked, and is republished carries the *same*
envelope `id` — which is the only reason the consumer's dedupe key works.

**`published_at` is set from the broker's acknowledgement, never before.** An
unacknowledged publish is an unpublished row, and the next pass republishes it.

`for update skip locked` is what lets N replicas run one loop against one table:
a row another publisher has claimed is skipped, not waited on, so a slow batch
in one replica cannot stall the rest.

## Why one language per service

Because the jobs are genuinely different, and a shared runtime would be a
compromise on all of them.

`identity` holds the keys to everything. It wants a static binary and a
compiler's worth of discipline around them — Go, `CGO_ENABLED=0`, distroless.
`courier` fans out to thousands of providers concurrently and holds none of them
up; that is the BEAM's whole reason for existing. `darkroom` pushes pixels and
does not want GC pauses in the middle of an encode — Rust. `billing` is pure
domain modelling with a state machine and integers in minor units — Ruby.
`muse` talks to models, and Python's ecosystem is unmatched there; it embeds
LiteLLM as a library rather than porting it. `guard` and `parlor` are both the
web, so they share a language and can share types across the gateway boundary.

**Polyglot, connected by contracts, never by shared code.** Two services that
both need a date-format library each use their own language's. There is no
shared internal package to version, which is precisely what lets a service be
upgraded on its own schedule — and it is the difference between this and a
monorepo that merely calls its directories "services".

## What the boundaries cost

Stated plainly, because a page that only sells the design is a marketing page.

- **No distributed transaction.** A user row and their first billing customer
  are two transactions. The platform's answer is the outbox plus
  at-least-once, which means eventual consistency and consumer-side idempotency
  rather than atomicity.
- **More moving parts to operate.** Seven services, five databases, a gateway,
  and eventually a broker. The [runbooks](/runbooks/) exist because of this.
- **Contract drift is a real failure mode**, which is why `core` freezes specs,
  every service pins `core:` in its manifest, and `caf contract lint` and
  `caf contract resolve` exist to gate it. The current drift is recorded in the
  [drift audit](/architecture/topology/#cross-repo-drift-audit) rather than
  smoothed over.
- **The boundaries are younger than the design.** `guard` routes nothing yet.
  `parlor`'s manifest is still the pre-`core` draft shape.
  `identity` cannot reset a password or renew an OIDC access token.
  `muse` does not verify the token it is handed.
  Read the status line on every service page before relying on it.

## Where the observability contract sits

Observability is a third mechanism, alongside HTTP for questions and events for
facts: **telemetry**, so you can see what happened without asking a service.

`core` owns the contract as **seven JSON schemas** under
`schemas/telemetry/` — span naming, traces, metrics, logs, redaction, probes, and
the `<SERVICE>_OTEL_ENDPOINT` contract — and enforces every rule with a test and
an invalid example. Each service implements it in its own language, by the same
rule that governs the outbox: core owns the contract, the service ships the
implementation.

**What is not true today:** no collector is deployed, no Grafana/Loki/Tempo/Mimir
stack is running, and `muse` is the only service exporting any signal. The
decision that *is* settled is that it is on by default and exercised in
development, with bring-your-own-endpoint and a one-variable disable as
first-class escape hatches. [Observability](/observability/) has the contract and
the gap.

## What to read next

- [Topology](/architecture/topology/) — ports, probes, environment variables,
  the dependency graph, and what is not wired yet.
- [Observability](/observability/) — the telemetry contract, and the gap between
  it and a running stack.
- [Contracts](/contracts/) — the manifest, the envelope, OpenAPI.
- [Upgrading](/upgrading/) — what changed in the contracts, and the order to fix
  it in.
- [Services](/services/) — one page per service.
- [Runbooks](/runbooks/) — how to run the thing.
