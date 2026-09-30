---
title: Contracts
description: cafaye.yml, OpenAPI documents, and the event envelope — how the services find each other.
---

**The authoritative spec lives in
[github.com/cafaye/core](https://github.com/cafaye/core), not on this site.**
This page is the summary; `core` is the source of truth, and where the two
disagree, `core` is right. Specs are manager-owned — a worker proposes, the
manager decides — so nothing here should be treated as settled until it appears
in `core`.

## `cafaye.yml` — the service manifest

Every cafaye repository carries one file, `cafaye.yml`, validated against
`core`'s
[manifest schema](https://github.com/cafaye/core/blob/master/schemas/cafaye.manifest.schema.json).
It is the one place that declares what a service is and what it speaks, so that
`caf init`, `caf dev`, `caf gen`, `pantry`, and `guard` all read the same six
facts instead of six bespoke config files.

```yaml
name: billing                      # the cafaye namespace name, also the event source
description: …                     # one sentence, shown by `caf new` and pantry
language: ruby                     # go|ruby|elixir|python|typescript|rust|spec
core: ^0.2.0                       # the core spec range this service compiles against

exposes:                           # omit entirely for libraries and spec-only repos
  api: openapi/openapi.yaml        # repo-relative path to an OpenAPI 3.1 document
  events: [billing.subscription.started]   # event types this service publishes

consumes: [identity.user.created]  # event types this service subscribes to
dependencies:                      # other cafaye services, not packages
  - name: identity
    version: ^0.1.0
    required: true

repository:
  url: git@github.com:cafaye/billing.git   # SSH only
  defaultBranch: master
  visibility: public

owner:
  team: billing
  contact: billing@cafaye.com
```

The schema is `additionalProperties: false` at every level, so a key `core` does
not define is an error rather than a silent no-op. A service name is
lowercase kebab-case and is simultaneously the repository name, the event
envelope's `source`, and the `guard` routing prefix — which is why the rules
are strict.

## The event envelope

Services talk to each other by publishing typed events, not by importing each
other's code. Every message is one envelope, defined in
`core/schemas/event-envelope.schema.json`, with a `data` payload that is **not**
opaque: per-event payload schemas live in `core` too, under
`schemas/events/<service>/<entity>/<action>.schema.json`.

Event types are always `<service>.<entity>.<action>` — three segments, always
prefixed with the publisher's own name, no exceptions. So
`identity.api_key.created` is legal in `identity` and a bug anywhere else.

Delivery is **at-least-once**. Every consumer must be idempotent, and services
publish through a transactional outbox rather than by calling a broker inside a
request.

## OpenAPI

HTTP surfaces are contract-first: each service that serves traffic publishes an
OpenAPI 3.1 document at the path `exposes.api` points to, and validates its own
responses against it in CI. The conventions — error envelopes, pagination,
idempotency keys, `traceparent` propagation — are written down in
[`core/docs/openapi-conventions.md`](https://github.com/cafaye/core/blob/master/docs/openapi-conventions.md).

## What this means for you

- **You do not write the contracts.** `core` owns them, `caf gen` generates your
  SDK from them, and drift is caught by a test rather than by a bug report.
- **You can take only what you need.** A project depends on `identity` and
  nothing else if that is all it needs. The platform is a set of independent
  services, not a monolith you must adopt wholesale.
- **Read `core` for anything binding.** This page is orientation; the schema and
  the convention documents are the contract.