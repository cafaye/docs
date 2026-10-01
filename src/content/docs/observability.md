---
title: Observability
description: The telemetry contract core owns, which services emit spans today, and the one thing that is specified but not yet deployed.
---

**What is specified, what is instrumented, and what is deployed are three
different lists, and this page keeps them apart.** Most of it is a contract you
can code against; the part a buyer needs is the per-service table below, and the
honest part of that table is its right-hand column.

:::caution[Status: the contract is shipped, four services emit spans, and
nothing anywhere is deployed to receive them]
`core` owns **seven telemetry schemas** and every rule in this page is one of
them, enforced by a test.

**`courier`, `billing`, `identity` and `muse` each wire an OpenTelemetry SDK and
export traces from their own code**, to whatever endpoint you point
`<SERVICE>_OTEL_ENDPOINT` at. The endpoint defaults to the collector that ships
with the stack, so it is on by default rather than opt-in.

**No collector is deployed in any cafaye environment.** That is the true
negative, and on its own it is the least useful sentence on this page. The
stack is not a design in progress: `kit` ships it as templates — the collector
config, the Tempo/Loki/Mimir configs, the Grafana provisioning, and two
dashboards — and `bin/dev` fetches the whole thing from a pinned ref and brings
it up.

**And `bin/dev` is the only thing that starts a collector, which is a smaller
adoption problem than it looks like.** A service repository's own
`docker-compose.yml` never mounts the collector's config, so bringing one up on
its own leaves the service exporting to a host that is not there. **`identity`,
`courier` and `billing` already carry `bin/dev`**; the other four do not, and
copying it is the whole fix:

```sh
# KIT is a checkout of cafaye/kit somewhere on this machine
cp "$KIT/templates/bin/dev.sh" ./bin/dev && chmod +x bin/dev
```

plus a `kit.ref` pinning a 40-character commit sha — `bin/dev` refuses a branch
name, loudly, before any network call, because a moving reference is a gate that
changes under you.
:::

## The three states

| State | What it means | Who has it |
| --- | --- | --- |
| **Spec'd** | `core` owns the contract and a rule exists, enforced by a test | every service, and the collector |
| **Instrumented** | the service wires an SDK and emits the signal from its own code, to an endpoint you supply | `courier`, `billing`, `identity`, `muse` (traces) |
| **Deployed** | a collector is running and spans are landing somewhere you can read | **nobody.** Not in any cafaye-operated environment |

These are not three ways of saying "less done".
A service can be fully instrumented with nothing to export to — which is the
normal state of a self-hoster's first day, and the state of every cafaye
environment today — and the work to close the gap is one variable and, for the
stack itself, one command.

## Per service

Read `core`'s
[`fleet.yml`](https://github.com/cafaye/core/blob/master/fleet.yml) for the
machine-readable version of this table, and
[Running the gates](/running-the-gates/) for the tier that checks this page
against it.

| Service | Spec'd | Instrumented | Deployed | What it emits |
| --- | :---: | :---: | :---: | --- |
| [`courier`](/services/courier/) | yes | **yes** | no | traces |
| [`billing`](/services/billing/) | yes | **yes** | no | traces |
| [`identity`](/services/identity/) | yes | **yes** | no | traces |
| [`muse`](/services/muse/) | yes | **yes** | no | traces |
| [`darkroom`](/services/darkroom/) | yes | no | no | correlated logs only — see below |
| [`guard`](/services/guard/) | yes | no | no | nothing |
| `parlor` | yes | no | no | nothing |

**Four services export traces and none of them exports metrics or logs.**
That is not modesty, it is what the code says: none of the four installs a
meter.
`courier` cannot — the Erlang SDK has no metrics API at all, which is why its
`lib/courier/telemetry.ex` argues the point from a directory listing rather than
from taste.
Metrics exist in the stack anyway: kit's collector derives them from spans with
the `spanmetrics` connector, **after** the redaction processor, so a metric
cannot carry a dimension the boundary would have stripped.

**`darkroom` is a fourth state, and it is worth naming rather than rounding to
"no".**
It has no `opentelemetry` dependency and no exporter; it uses the Rust `tracing`
facade with a JSON subscriber and keeps its own `trace_id` in a task-local, so
the response header, the problem body, and every log line under the request read
the same value.
That is a real correlation story and it is not an OTLP span story.
Its log records do reach the stack, indirectly: the collector's `syslog/crash`
receiver reads every container's stderr, so a `tracing` line becomes a log
record in Loki with no per-language SDK at all.

**`guard` and `parlor` emit nothing.**
They owe the probe contract — `/healthz` and `/readyz` — and that is the whole
of their telemetry surface.

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
  fails if unsetting the endpoint stops being declared as free. `OTEL_SDK_DISABLED`
  and `<SIGNAL>_EXPORTER=none` are the OpenTelemetry specification's own kill
  switches, and the services read those rather than reimplementing "disabled" in
  four languages.

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

:::caution[Two of the four exporters are on core's vocabulary; `muse` is not,
and `billing` is on a list of its own]
`core`'s vocabulary is thirteen classes.
`courier` and `identity` both carry all thirteen, and both collapse anything
else to `_OTHER` — `identity` has a test that walks its list against core's
schema, and `courier` has one per vocabulary member — so an error span from
either aggregates across the fleet.

**`muse` is not.**
It still emits `error.type = "ProviderAuthError"`, a per-service exception class
name, and its own test asserts that exact string.
That is precisely what the spec forbids, because it means `error.type` means
something different in Python than it would in Go or Elixir.

**`billing` is a third case, and it is a real drift rather than a rounding.**
Its vocabulary is three values of its own — `unhandled_exception`,
`routing_error`, `middleware_error` — and none of the three is in core's
thirteen, so a billing error span would fail `traces.schema.json`.
`billing`'s repository owns that fix; it is recorded in `core`'s `fleet.yml`
rather than fixed here, because a service repository is read-only from this one.

The practical rule until all three agree: **do not write a dashboard that groups
on `error.type` across all services.**
A panel that is full for two services and empty for another reads as "no errors
in `muse`", which is the worst possible reading of a real error.
Group on the span status instead — which is what kit's shipped fleet-errors
dashboard does, and it is the reason a cross-service error view is possible at
all today.
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
`cafaye.yml` is.

**`kit` carries the stack, and it is complete rather than a sketch.** Its compose
templates are Postgres, NATS+JetStream, Redis, the OpenTelemetry Collector, and
the four LGTM services behind it — Grafana, Loki, Tempo, Mimir — plus the
six-language OTel snippets. The collector's three pipelines fan out for real:
traces to Tempo, metrics to Mimir, logs to Loki, and `debug` alongside them as a
local escape hatch that writes to the collector's own stdout. Every address is a
`${KIT_*}` substitution, so pointing one at a backend you already run bypasses
the shipped stack rather than extending it — which is the supported way to bring
your own.

**The redaction boundary is enforced in that collector, and the allowlist is
derived rather than transcribed.** Every attribute `core` allows on a signal is
in the collector's `allowed_keys` for that signal, and nothing is in it that
`core` does not allow; `kit`'s gate reads `core`'s schemas off disk and compares
both ways, printing the core commit it compared against. A metric cannot escape
the boundary either, because `spanmetrics` runs after the redaction processor.

**How you get it running.** Copy `kit`'s `bin/dev` into a service repository and
run it: it fetches the stack from a pinned ref, brings it up with `--wait`,
migrates, and prints the URLs. It is in `courier`, `billing` and `identity` today.
`kit` proves the fetched stack actually runs rather than merely parsing —
`tests/stack_live_test.sh` brings the whole thing up, sends real OTLP, and reads
a trace back out of Tempo and a metric out of Mimir, asserting the redaction
canary is in neither.

**Known drift, recorded rather than papered over.** `muse` reads
`MUSE_OTEL_EXPORTER_OTLP_ENDPOINT` — the OpenTelemetry standard spelling —
while this spec and `core`'s `fleet.yml` say `MUSE_OTEL_ENDPOINT`. Three places,
three spellings, and `muse` agrees with neither. The rename is one string in
`muse`'s main module and one line in its config test, and it is cheaper today
than after three more services have copied the spelling out of `muse`'s code.

## What does not exist yet

Stated so a reader can tell the difference between "not built yet" and "not
planned":

- **No collector is deployed in any environment.** The stack is generatable and
  `kit` has a test that runs it, but nothing in a cafaye-operated deployment
  receives a span. This is the one line on this page that has no code behind it,
  and it is the whole of what "not deployed" means.
- **The shipped dashboards are provisioned, not curated, and they are new.** `kit`
  ships two: *cafaye — every error in the fleet* (twelve panels, grouped on span
  status rather than `error.type`) and *cafaye — local stack*. They come up on
  first load with no configuration, and they are the reason a cross-service error
  view is possible today rather than a thing you would have to write. What does
  not exist is a dashboard maintained against a real incident.
- **`muse` is not migrated to the bounded `error.type` vocabulary,** and
  `billing` is on a divergent list of its own. `courier` and `identity` are on
  core's thirteen. See [`error.type`](#errortype) above for what that means for
  a panel.
- **`darkroom`, `guard` and `parlor` export no OTel signal.** `darkroom` has a
  real correlation story on `tracing` and reaches Loki through the collector's
  stderr receiver; the other two owe the probes and nothing more.
- **`core` owns the contract only.** There is deliberately no collector, exporter
  or per-language SDK in `core` — that is `kit`'s job and each service's. A rule
  added to `core` that no service implements is a rule that lies.

## See also

- [Topology](/architecture/topology/) — the probes table, and the variables each
  service actually reads.
- [Contracts](/contracts/) — the rest of the spec surface.
- [Running the gates](/running-the-gates/) — how each repository's suite is run,
  including the tiers that do not run by default.
