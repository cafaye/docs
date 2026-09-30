---
title: Observability
description: The telemetry contract core owns, what is deployed today, and the three things that are specified but not yet running.
---

**What is specified. What is deployed is a different, smaller list, and the two
are not the same thing.** Read the status line first: this page is mostly a
contract you can code against and a list of what has not been built yet.

:::caution[Status: the contract is shipped; the stack is not running]
`core` owns **seven telemetry schemas** and every rule in this page is one of
them, enforced by a test. **No collector is deployed and no observability stack
is running.** The OpenTelemetry Collector and the self-hosted
Grafana/Loki/Tempo/Mimir stack are in flight; `kit` carries the compose
template and the six-language SDK snippets, and neither is wired to a running
service yet.

**Exactly one service exports any signal at all**: `muse`, and it exports
traces. `identity`, `billing`, `courier` and `guard` export none — every one of
them serves HTTP and so owes the `/healthz`–`/readyz` split, and that is the
whole of its telemetry surface today.
:::

**The decision that is settled: on by default, and exercised in development.**
A developer working on cafaye sees real traces, real metrics and a real error
view with nothing switched on, because the default endpoint points at the
collector that ships with the local stack. Two escape hatches are first-class
rather than an afterthought:

- **Bring your own backend.** A self-hoster already running Datadog, Honeycomb or
  Grafana Cloud points `<SERVICE>_OTEL_ENDPOINT` at it, and the shipped stack goes
  quiet. That is a **supported deployment, not a degraded mode.**
- **One variable to turn it off.** Unset the variable and the service gets a
  genuine no-op. `core` asserts that path rather than trusting it: the schema
  declares `required` as `const: false`, and a test named for the no-op path
  fails if unsetting the endpoint stops being declared as free.

The specs live in
[cafaye/core](https://github.com/cafaye/core/blob/master/docs/observability.md)
and are manager-owned. This page summarizes and links; it does not define.

## The seven schemas

A rule that is not in `schemas/` is not a cafaye rule. Every rule below is a
JSON Schema constraint, and each has an invalid example under
`examples/invalid/` naming the exact keyword it exists to reject.

| Schema | What it decides |
| --- | --- |
| [`span-naming.schema.json`](https://github.com/cafaye/core/blob/master/schemas/telemetry/span-naming.schema.json) | one span-name scheme, low-cardinality by construction |
| [`traces.schema.json`](https://github.com/cafaye/core/blob/master/schemas/telemetry/traces.schema.json) | the trace attribute allowlist |
| [`metrics.schema.json`](https://github.com/cafaye/core/blob/master/schemas/telemetry/metrics.schema.json) | the measurement allowlist, and the ban on unbounded identifiers |
| [`logs.schema.json`](https://github.com/cafaye/core/blob/master/schemas/telemetry/logs.schema.json) | the log attribute allowlist |
| [`redaction.schema.json`](https://github.com/cafaye/core/blob/master/schemas/telemetry/redaction.schema.json) | the redaction boundary, and where it is enforced |
| [`otel-endpoint.schema.json`](https://github.com/cafaye/core/blob/master/schemas/telemetry/otel-endpoint.schema.json) | the `<SERVICE>_OTEL_ENDPOINT` contract and the no-op path |
| [`probes.schema.json`](https://github.com/cafaye/core/blob/master/schemas/telemetry/probes.schema.json) | `/healthz` unconditional, `/readyz` really checking |

## Span names

```
span-name := <service> "." <operation> [ "." <target> [ "." <qualifier] ] ]
service   := cafaye namespace name — kebab-case, may contain a dash
operation := lowercase word, optional internal underscore, at most 15 characters
```

**Good:** `muse.request` · `muse.route` · `muse.provider.call` ·
`identity.db.query` · `courier.email.deliver` · `guard.request.authorize`

**Never:** `GET /users/:id` · `get_user` · `users.GET` ·
`muse.user.usr_01J9Z8QK5M4N7P2R3T6V8W9X0A`

The prefix is mandatory and it is the emitting service's own `name`, the same
rule as an event type's `<service>.<entity>.<action>`. The form is deliberately
the *same shape*, so the fleet has one dotted-lowercase grammar rather than two.

**The 15-character segment bound is what does the work.** A name that
interpolates a value is rejected not because the grammar knows about cafaye id
formats but because no legal segment is twenty-six characters long. A trace
backend is a search engine, and the index becomes unusable long before anyone
notices.

The name is the **operation**; everything else is an **attribute**. An attribute
in the name is an attribute that cannot be filtered out. `kind` — `internal`,
`server`, `client`, `producer`, `consumer` — is a span *field*, never part of
the name.

## Attributes are allowlisted, per signal

Default-deny: an attribute that is not on its signal's list **is not emitted**,
so something added in a hurry is dropped rather than shipped.

| Attribute | traces | metrics | logs |
| --- | :---: | :---: | :---: |
| `http.request.method` | ✓ | ✓ | |
| `http.response.status_code` | ✓ | | |
| `http.response.status_code_class` | | ✓ | |
| `http.route` | ✓ | ✓ | |
| `db.system` · `db.operation` | ✓ | ✓ | |
| `messaging.system` | ✓ | ✓ | |
| `messaging.operation` | ✓ | | |
| `otel.status_code` | ✓ | | |
| `error.type` | ✓ | ✓ | ✓ |
| `log.severity` | | | ✓ |
| `service.name` | | | ✓ |

Two of those rows carry the design:

- **`http.route` is the template.** `/v1/users/{id}` is one value per endpoint.
  `/v1/users/usr_01J9Z8QK5M4N7P2R3T6V8W9X0A` is one per request, which is why
  `url.path` and `url.full` are on no list at all.
- **Metrics are coarser than traces on purpose.** Traces carry the status code;
  metrics carry the status *class*. A metric multiplied by 500 codes and every
  route is how a service hits a series cap inside a week, and `4xx` answers the
  question a dashboard actually asks.

## The prohibition: no unbounded identifier on a measurement

A tenant id, a user id, a request id, an event envelope id — none of them may be
a **metric label**. It is the failure that looks harmless while you have one
tenant and costs you the whole time series after you have a thousand.
`error.type` × `service.name` is what you aggregate on instead.

## The redaction boundary

**Prompt and completion content must never appear in a telemetry span.** `muse`
is an LLM gateway, so its spans will *naturally* want to record the prompt —
"which model, which prompt shape, how long" is the obvious thing to instrument,
and it is the obvious thing that writes every customer's content into a
searchable, retained, widely-readable store.

Encoding "don't log secrets" in prose has been tried across this fleet and it
does not hold, so the spec encodes the **allowlist** instead. What may be
recorded about an LLM call is a fact about **how it was served**:

| Attribute | Fact it is about |
| --- | --- |
| `llm.model` | which model served the call |
| `llm.tokens_in` / `llm.tokens_out` | the **count**, never the text it counted |
| `llm.latency_ms` | how long |
| `llm.finish_reason` | the **class** — `stop`, `length`, `tool_call` |
| `llm.provider` · `llm.cost_micros` · `llm.candidates_tried` · `llm.breaker_state` | the routing decision |

**May never be recorded, anywhere:** the prompt, the completion, message
content, tool arguments, system instructions, the transcript, anything a caller
typed, a credential, `error.message`, or a stack trace.

## `error.type`

A **low-cardinality class**: snake_case, at most 64 characters, drawn from a
vocabulary the whole fleet shares. Never a message, never a stack trace, never
an interpolated value.

:::caution[No service has been migrated to this vocabulary yet]
`muse` — the only service that exports a signal at all — still emits
`error.type = "ProviderAuthError"`, and its own test asserts that exact string.
That is a per-service exception class name, which is exactly what the spec
forbids, because it means `error.type` means something different in Python than
it would in Go or Elixir, and "one place to see all errors for the whole system"
becomes six places.

The vocabulary is being closed into a bounded enum. **Migration is a later
packet.** Until it lands, do not write a dashboard that groups on `error.type`
across services — `muse` will not join it, and a panel that is empty for one
service and full for another reads as "no errors in `muse`", which is the worst
possible reading of a real error.
:::

## `/healthz` and `/readyz`

Liveness and readiness are the two halves of "what does green mean", and
`darkroom` is the pattern. Both are specified as schemas, which means both
failure directions are machine-checked:

- **`/healthz` is unconditional.** Its dependency list is constrained to be
  *empty*, so a liveness probe that starts checking the database **cannot
  validate**. A liveness probe that fails on a dependency tells the orchestrator
  to restart a process that is fine, which turns a database outage into a
  fleet-wide crash-restart loop and destroys the evidence you need to diagnose
  it.
- **`/readyz` really checks.** Its check list has a **minimum of one**, so a
  service with a `readyz` that checks nothing **fails the schema**. That failure
  is invisible in practice — the endpoint returns `200` and looks perfect in
  every dashboard — and a load balancer will cheerfully route traffic into a
  service whose database is gone.
- **Both are exempt from authentication**, by an explicit path allow-list rather
  than by route order. `axum`'s `Router::layer` applies to every route the router
  holds, so registering the probes "before" the auth layer does not exempt them:
  a `/healthz` behind the auth middleware returns `401`, every instance is marked
  unhealthy, and the deployment rolls back with nothing in the logs saying why.

## What a service does with this

`caf contract lint` reads these seven schemas alongside the event schemas, so a
service's telemetry declaration is checked against `core` the same way its
`cafaye.yml` is. `kit` carries the six-language OTel templates and the compose
stack (Postgres, NATS, Redis, and the collector) for local development; the
collector template ships with **only the `debug` exporter**, so a developer's
laptop cannot send a span anywhere on its own, and every published port is a
`${KIT_*}` substitution.

**Known drift, recorded rather than papered over.** `muse` reads
`MUSE_OTEL_EXPORTER_OTLP_ENDPOINT` — the OpenTelemetry standard spelling —
while this spec and `core`'s `fleet.yml` say `MUSE_OTEL_ENDPOINT`. Three places,
three spellings, and `muse` agrees with neither. The rename is one string in
`muse`'s main module and one line in its config test, and it is cheaper today
than after three more services have copied the spelling out of `muse`'s code.

## What does not exist yet

Stated so a reader can tell the difference between "not built yet" and "not
planned":

- **No collector is deployed**, and no Grafana/Loki/Tempo/Mimir stack is running.
- **There is no shared error dashboard.** The attribute that would make one
  possible is specified; the dashboard that would use it is not written.
- **No service is migrated to the bounded `error.type` vocabulary.**
- **`core` owns the contract only.** There is deliberately no collector, exporter
  or per-language SDK in `core` — that is `kit`'s job and each service's. A rule
  added to `core` that no service implements is a rule that lies.

## See also

- [Topology](/architecture/topology/) — the probes table, and the variables each
  service actually reads.
- [Contracts](/contracts/) — the rest of the spec surface.
- [Running the gates](/running-the-gates/) — how each repository's suite is run,
  including the tiers that do not run by default.
