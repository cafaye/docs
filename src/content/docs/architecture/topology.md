---
title: Topology
description: The operator's view — ports, probes, environment variables, dependencies, and what is not wired yet.
---

Every row here was read out of a service repository: its `cafaye.yml`, its
`Dockerfile`, its `docker-compose.yml`, and its source. Where a repository and
this table disagree, the repository is right — and the fix is an edit here, not
a workaround you invent.

[Architecture](/architecture/) explains *why* the services are split this way.
This page is the reference you keep open during an incident.

**The data topology is one Postgres, not one per service.** A service that has a
database has its own database *on a shared cluster*, with its own role and nothing
that lets it reach another service's. [One cluster, many
databases](/architecture/one-cluster/) is what the boundary is, what it costs,
and the one query that tells you whether it is still in place; read it before
concluding anything from this table about who can see what.

## The table

| Service | Language | Container port | Local port | Database | `core:` |
| --- | --- | --- | --- | --- | --- |
| `identity` | Go | 8080 | 8080 | Postgres via `kit`'s container, own database **on the shared cluster** | `^0.1.0` |
| `billing` | Ruby | 80 | 3000 (host `bin/rails server`) | Postgres via `kit`'s container, own database **on the shared cluster** | `^0.2.0` |
| `courier` | Elixir | 4000 | 4000 | Postgres via `kit`'s container, own database **on the shared cluster** | `^0.1.0` |
| `darkroom` | Rust | 8080 | 8080 | Postgres 17, own database — **its own container, not the cluster** | `^0.2.0` |
| `muse` | Python | 8000 | 8000 | Postgres 17, own database — **its own container, not the cluster** | `^0.2.0` |
| `guard` | TypeScript (Bun) | 8080 | 8080 | **none** — `Map`s and, with `REDIS_URL`, Redis | `^0.1.0` |
| `parlor` | Next.js | 3000 | 3000 | **none** | *manifest is a pre-`core` draft* |

**The two bolded clauses in the Database column are different arrangements, not
different wording.** `identity`, `billing` and `courier` reach their database
through `bin/dev`, which brings up **one** Postgres container for the whole
fleet and gives each of them a database and a role inside it; they publish no
database of their own. `darkroom` and `muse` still ship a **complete**
`docker-compose.yml` with their own `postgres:17-alpine`, so each of them runs a
Postgres that is its own, and neither is on the shared cluster. See [the drift
audit](#cross-repo-drift-audit) — `kit`'s own fleet gate names both.

**17 is the standard, and the tag you get is not always 17.** `muse` **was** on 18
and was moved down deliberately — one platform, one major version, one upgrade
path — and its own compose file carries the migration note for a developer
holding a real 18 data directory. `darkroom` and `muse` pin `17-alpine`
literally. **`identity`, `courier` and `billing` pin no tag of their own**,
because they reach their database through `kit`'s container, and that leaves
**three** values in play rather than one: kit's compose file writes
`image: postgres:${KIT_POSTGRES_TAG:-17-alpine}`, the `.env` `bin/dev` creates on
a first run comes from `kit`'s `.env.example` and sets
`KIT_POSTGRES_TAG=16.6-alpine`, and `caf dev` renders `postgres:16-alpine`. All
three are tabulated in [the version skew
trap](/runbooks/service-down/#step-5--the-postgres-version-skew-trap) and
explained in [getting started](/getting-started/) — change it in your `.env` if
you need 17, and do not assume it from the compose file.

**Most databases take the name of the service that owns them, and the exception
is `darkroom`.** `identity`, `billing` and `courier` each set
`POSTGRES_DB: <service>`, `muse` sets `POSTGRES_DB: muse`, and `guard` and
`parlor` have no database at all. `darkroom`'s own stack sets **`POSTGRES_DB:
darkroom_test`** while its role is `darkroom`, so for that one service the
database named in the DSN and the role that connects to it are spelled
differently.

Three services want host port **8080** (`identity`, `guard`, `darkroom`), and two
want **3000** (`billing`, `parlor`), so run one of each at a time on a laptop.

**Only two services publish a Postgres port on the host:** `darkroom` on `5432`
and `muse` on `5433`, both as literals. `identity`, `courier` and `billing`
publish **none** — their databases are reached over the compose network by
service name, and kit's fetched stack publishes its own on `KIT_POSTGRES_PORT`
(default `15500`). **There is no `POSTGRES_PORT` variable in any service
repository**; the variable that exists is `KIT_POSTGRES_PORT`, it lives in kit's
`.env`, and a service's own compose file may not move it. The trap is
`darkroom`'s 5432 landing on a native Postgres that is already there: the
container reports **healthy** (`pg_isready` does not authenticate) while your
command reaches the wrong database.

**That one `KIT_POSTGRES_PORT` is the whole fleet's database, not one service's.**
It is a single container holding a database and a role for every service that
declared one, so a second `docker compose up` in another service's checkout
binds a port the first already holds. One cluster is also why
`identity`, `courier` and `billing` name the same host and differ only in the
database: `postgres://<service>:<password>@postgres:5432/<service>` over the
compose network, and a DSN pointed at the wrong service's database fails with
`permission denied for database` rather than with a missing role.

**`core:` is not uniform, and that is recorded rather than fixed.** Four
repositories still pin `^0.1.0`, which resolves to a `core` below the `0.2`
spec several of them compile against. The pin is the manager's to cut, and every
service has to move at the same time — `^0.2.0` means `>=0.2.0 <0.3.0`, so a
service that moved and one that did not would be compiling against two different
specs. `caf contract resolve` answers the question per manifest:
`caf contract resolve '^0.1.0' 0.2.0` → `no`.

`darkroom`'s image is built from **`docker/Dockerfile`**, not `./Dockerfile`, and
needs no build flags — that file already runs `--features s3`, so the default
build is the deployment build.

## Probes

Liveness and readiness are separate everywhere, and the split is the same rule
in every service: **liveness answers whenever the process can dispatch, so a
dependency outage never restarts the container.** Only readiness is allowed to
go 503 because something else is down. Restart on a readiness failure and a
database blip becomes a crash loop.

| Service | Liveness | Readiness | 503 body when a dependency is down |
| --- | --- | --- | --- |
| `identity` | `GET /healthz` → always 200 | `GET /readyz`, each probe bounded at 2s | `{"status":"unavailable",…}` |
| `billing` | `GET /healthz` → always 200 | `GET /readyz` | `{"status":"error","checks":{"database":"error"}}` |
| `courier` | `GET /healthz` → never touches the database | `GET /readyz` | `{"status":"error","checks":{"database":"unavailable"}}` |
| `darkroom` | `GET /healthz` → consults nothing | `GET /readyz` → really runs a query | the probe reason is logged, never returned |
| `muse` | `GET /healthz` → consults nothing | `GET /readyz` → reports the `db` slot | — |
| `guard` | `GET /healthz` → always 200 | `GET /readyz` | `{"deps":{"identity":"ok","redis":"unavailable"}}` |
| `parlor` | `GET /healthz` → 200 | `GET /readyz` | `{"status":"ok","deps":"none"}` — `deps` is a placeholder |

Two probe facts that are not obvious from the table:

**`courier`'s readiness is slow when the database is gone** — about 4.4 seconds,
which is the pool's queue backpressure rather than the query timeout. Set the
probe timeout above 5s. An orchestrator that gives up sooner reads the same
verdict, but it will also restart a service that is answering correctly.

**Probe failures are logged, never returned.** The underlying error — a host, a
port, a rejected password — goes to the log and not into the response body,
because an unauthenticated `GET /readyz` must not be a way to discover that the
database is at `10.0.0.5`. If you are reading a 503 with no detail, the detail
is in the service's logs, and that is by design.

`muse` deliberately leaves the probes out of its OpenAPI document, and `billing`
deliberately does not declare them in `exposes` — they are infrastructure, not
contract surface, and no client should parse them.

## Environment variables

Read at startup, validated, and never mutated. A value that is present but
invalid fails startup rather than falling back to a default, so a typo in a
deployment is a crash with a message instead of a service listening on the
wrong port.

### identity

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | TCP port to bind. Must be 1–65535. |
| `DATABASE_URL` | *unset* | Postgres DSN. **Optional**: unset means no pool and no readiness dependency, and the `/v1` routes are not registered at all. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. |
| `IDENTITY_OTEL_ENDPOINT` | `http://otel-collector:4318` | Where traces go. Set it to any OTLP endpoint — the shipped collector, Datadog, Honeycomb, Grafana Cloud — and it wins. `OTEL_EXPORTER_OTLP_ENDPOINT` is honoured as a fallback, and `OTEL_SDK_DISABLED=true` or any `OTEL_*_EXPORTER=none` is a genuine no-op. |

### guard

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Listen port. |
| `IDENTITY_ISSUER` | `https://identity.localhost` | Issuer-only base URL. `guard` appends `/.well-known/jwks.json` itself. Also the expected `iss`. |
| `IDENTITY_JWKS_URL` | derived from the issuer | Full key-set URL, for a key set served anywhere other than the issuer's well-known path. |
| `IDENTITY_JWKS_TTL_MS` | `300000` | How long a fetched key set is reused. **Also the revocation window.** |
| `GUARD_CLIENT_ID` | `guard` | The `aud` guard accepts. |
| `IDENTITY_URL` | `http://localhost:8080` | identity's base URL for the `/auth` **calls** — where a session is *requested*. |
| `REDIS_URL` | *unset* | `redis://` or `rediss://` — host and port, no path. **Set it and the rate-limit counters are shared by every replica and survive a restart.** Unset and they are this process's memory. |
| `REDIS_PREFIX` | `guard:rl` | Sub-namespace inside guard's own, so two guards or two environments sharing one Redis do not read each other's buckets. |

`IDENTITY_URL` is a second variable for one service on purpose. The issuer is
an https origin in every environment; the address `guard` *dials* is a service
name, and inside a container `localhost` is `guard` itself. Leave it unset in a
container and you get a gateway asking itself for a session.

An empty or whitespace-only value counts as unset. A malformed one is a startup
error, never a silent default: `IDENTITY_JWKS_TTL_MS=soon` refuses to boot
rather than quietly fetching identity on every request, and `REDIS_URL=redis//redis`
refuses to boot rather than falling back to memory.

**What Redis does and does not fix.** It makes the **rate-limit counters**
shared and durable. It does **not** make browser sessions shared: the
`SessionStore` is a `Map` in one process regardless. See
[guard](/services/guard/).

### billing

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | — | Postgres DSN. |
| `STRIPE_WEBHOOK_SECRET` | — | The Stripe endpoint signing secret. |
| `STRIPE_WEBHOOK_SECRETS` | — | **Comma-separated list** of signing secrets, tried in order. This is the rotation path; see [rotating secrets](/runbooks/secret-rotation/). |
| `STRIPE_WEBHOOK_TOLERANCE` | `300` | Signature timestamp tolerance, in seconds. |
| `BILLING_OTEL_ENDPOINT` | `http://otel-collector:4318` | Where traces go. Any OTLP endpoint; unset means the shipped collector. The exporter itself is named by Rails configuration, not by an environment variable, and an unrecognised name is a boot error rather than a silent default. |

With none of the `STRIPE_WEBHOOK_*` variables set, the webhook endpoint
answers **503**, not 400. Telling Stripe its signature is bad when the service
cannot check it at all sends an operator looking in exactly the wrong place.

### muse

| Variable | Default | Meaning |
| --- | --- | --- |
| `MUSE_VAULT_KEY` | **none** | base64, decoding to exactly 32 bytes for AES-256. **`muse` will not start without it.** |
| `MUSE_DATABASE_URL` | — | Postgres DSN for the vault and the outbox. |
| `MUSE_ROUTES_FILE` | — | Path to the routing table. |
| `MUSE_ENV` | — | Environment name. |
| `MUSE_CORE_SCHEMAS` | — | Path to core's schemas, for contract validation. |
| `MUSE_OTEL_EXPORTER_OTLP_ENDPOINT` | — | Where traces go. **This is the OTel standard spelling, not core's `<SERVICE>_OTEL_ENDPOINT` contract** — a recorded drift, and the only service that reads it that way. |

Generate a vault key with the module's own entry point:

```sh
uv run python -m muse.vault
```

There is no default and no fallback, and that is the design: a vault that boots
with a fallback key is a vault whose keys are readable by anyone who has read
the source. An empty, non-base64, or wrong-length value is a boot failure, and
the error names the variable and never its value — a variable's value in a boot
error is a credential in whatever the operator pastes the error into.

### darkroom

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Listen port. |
| `DATABASE_URL` | — | Postgres DSN. |
| `DARKROOM_OBJECT_STORE` | — | `memory` or `s3`. `memory` for development; the deployment build is `s3`. |
| `DARKROOM_S3_BUCKET` | — | Bucket name. |
| `DARKROOM_S3_ENDPOINT` | — | Account-scoped endpoint for R2. `region=auto` with no endpoint is **refused at startup** so a bucket-only config cannot silently resolve `s3.amazonaws.com`. |
| `DARKROOM_S3_REGION` | `auto` for R2 | A real region on an R2 endpoint is **refused at startup**, naming the variable and the value. |
| `DARKROOM_JWKS_URL` | — | identity's key set. `darkroom` verifies tokens **locally** and reads `account_id` and scopes from the verified token. |
| `DARKROOM_ISSUER` · `DARKROOM_AUDIENCE` | — | The expected `iss` and `aud`. |
| `DARKROOM_ENV` | `production` | `development` enables the HMAC verifier, which exists only behind `--features dev-auth`. |
| `DARKROOM_LOG_FORMAT` · `DARKROOM_LOG_LEVEL` | — | Log shape. |

`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are the AWS SDK's own chain, and
an R2 API token has exactly those two halves — so no cafaye-specific credential
variable exists for object storage.

### courier

`courier`'s own configuration is not on this page and this packet did not add
it; the telemetry variables it reads are, because they are the ones that decide
where a span goes.

| Variable | Default | Meaning |
| --- | --- | --- |
| `COURIER_OTEL_ENDPOINT` | `http://otel-collector:4318` | Where traces go. `OTEL_EXPORTER_OTLP_ENDPOINT` is the fallback, and the cafaye name wins when both are set. |
| `COURIER_TENANT_ID` | *unset* | Put on the **resource**, not on a measurement. It is exempt from OpenTelemetry's 2000-attribute-combination cap, which is the point: a tenant on a measurement makes every per-tenant breakdown silently undercount. |

### Telemetry, across the fleet

One variable per service, and it is the whole contract between a service and an
observability backend.

| Variable | Read by | Default | Emits |
| --- | --- | --- | --- |
| `COURIER_OTEL_ENDPOINT` | `courier` | `http://otel-collector:4318` | traces |
| `BILLING_OTEL_ENDPOINT` | `billing` | `http://otel-collector:4318` | traces |
| `IDENTITY_OTEL_ENDPOINT` | `identity` | `http://otel-collector:4318` | traces |
| `MUSE_OTEL_EXPORTER_OTLP_ENDPOINT` | `muse` | *unset* | traces |
| — | `darkroom`, `guard`, `parlor` | — | nothing |

**Unset does not mean off for the first three, and that is deliberate.** The
default is the collector that ships with the stack, so a developer sees real
traces with nothing switched on; a self-hoster who already runs a backend sets
the variable and the shipped stack goes quiet.
The two kill switches are the OpenTelemetry specification's own —
`OTEL_SDK_DISABLED=true`, or any of `OTEL_TRACES_EXPORTER`,
`OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER` set to `none` — and the services
read those rather than reimplementing "disabled" in four languages.
**No collector is deployed in any environment**, so a service started from its
own `docker-compose.yml` is exporting to a host that is not there; see
[Observability](/observability/) for the three states and `bin/dev`.

## HTTP surfaces

What each service answers today. `identity` serves **two** documents — `/v1` and
the OIDC provider surface — and `parlor`'s routes are not in either.

### identity — port 8080

| Method | Path | Auth | What it does |
| --- | --- | --- | --- |
| GET | `/healthz` | none | Liveness. |
| GET | `/readyz` | none | Readiness. |
| POST | `/v1/users` | none | Register. `409` if taken, `422` on a bad field, `400` on malformed JSON, `413` past 4 KB. |
| POST | `/v1/session` | none | Log in. `401` for any unusable credential, `423` + `Retry-After` while locked. Sets `__Host-session`. |
| DELETE | `/v1/session` | bearer or cookie | Revoke. `204`. |
| GET | `/v1/me` | bearer or cookie | The authenticated user. |
| POST | `/v1/accounts` | bearer or cookie | Create an account (a team). Registration also creates a personal one. |
| GET | `/v1/accounts` | bearer or cookie | The caller's own accounts. |
| GET | `/v1/accounts/{accountID}` | member | One account. |
| PATCH | `/v1/accounts/{accountID}` | admin | Rename. |
| DELETE | `/v1/accounts/{accountID}` | **owner** | Delete. |
| GET | `/v1/accounts/{accountID}/members` | member | Members. |
| POST | `/v1/accounts/{accountID}/invitations` | admin | Invite. Returns the invitation **token** in the body. |
| PATCH | `/v1/accounts/{accountID}/members/{userID}` | **owner** | Change a role. |
| DELETE | `/v1/accounts/{accountID}/members/{userID}` | admin | Remove a member. |
| POST | `/v1/invitations/accept` | bearer or cookie | Redeem an invitation. |
| POST | `/v1/accounts/{accountID}/oidc-clients` | **owner** | Register an OIDC client. Owner-gated because `identity` has no platform-admin role yet. |
| DELETE | `/v1/accounts/{accountID}/oidc-clients/{clientID}` | **owner** | Revoke a client. |

Roles are `owner`, `admin`, `member` — a PostgreSQL enum, ordered, and the
ordering is what `AtLeast` compares.

**The OIDC provider surface**, delegated per-path to the `zitadel/oidc` library's
own router — deliberately **not** a root `Mount`, because that would hand the
library the unmatched-path case and give a client that guessed a route wrong two
error shapes to parse.

| Path | What |
| --- | --- |
| `/.well-known/*` | Discovery and the JWKS. `guard` verifies against `/.well-known/jwks.json`. |
| `GET`/`POST` `/oidc/authorize` | The authorization request. `GET` is not an accident: OIDC Core permits both and a product behind a strict corporate proxy may have no choice. |
| `GET` `/oidc/callback` | The redirect target. |
| `POST` `/oidc/token` · `GET`/`POST` `/oidc/userinfo` | Token and userinfo. |
| `/oidc/login` | The login page, bound to this service's own sessions. |

Not mounted, and **absent from the discovery document** rather than stubbed:
refresh tokens, the implicit flow, client credentials, dynamic client
registration, introspection, the revocation endpoint, end-session, and the device
flow.

### darkroom — port 8080

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/v1/uploads` | `201` with a presigned `upload_url` and a `storage_key`. The bytes never pass through this service. |
| POST | `/v1/uploads/{id}/complete` | `200` asset ready, or `409` (object absent) / `422` (checksum mismatch). Reads the object back and hashes it. |
| GET | `/v1/assets` | List, tenant-scoped. |
| GET · DELETE | `/v1/assets/{id}` | Read one; delete. |
| POST · GET | `/v1/assets/{id}/variants` | Generate; list. |

Authenticated against identity's key set, locally. `Idempotency-Key` on the
creating calls.

### billing — port 3000 in development, 80 in the image

| Method | Path | Auth | What it does |
| --- | --- | --- | --- |
| GET | `/healthz` | none | Liveness. |
| GET | `/readyz` | none | Readiness. |
| GET | `/up` | none | Rails' own boot check. 500 if the app did not boot. |
| GET | `/v1/customers` | bearer | List. |
| POST | `/v1/customers` | bearer | Create. |
| GET | `/v1/customers/{id}` | bearer | One customer. |
| PATCH | `/v1/customers/{id}` | bearer | Update. |
| GET | `/v1/plans` | bearer | List plans. |
| POST | `/v1/plans` | bearer | Create a plan. |
| GET | `/v1/plans/{slug}` | bearer | Read by **slug**. |
| PATCH | `/v1/plans/{id}` | bearer | Write by **id**. |
| GET | `/v1/subscriptions` | bearer | List. |
| POST | `/v1/subscriptions` | bearer | Create. **Returns a Checkout URL and writes nothing.** |
| GET | `/v1/subscriptions/{id}` | bearer | One subscription. |
| POST | `/v1/subscriptions/{id}/cancel` | bearer | Ask the processor to cancel. Returns the row unchanged. |
| POST | `/v1/subscriptions/{id}/change_plan` | bearer | Ask the processor to move plans. Returns the row unchanged. |
| GET | `/v1/subscriptions/{id}/entitlements` | bearer | What the plan grants. |
| POST | `/v1/webhooks/stripe` | **Stripe signature** | Payment-processor events in. |

Money crosses the wire as integer minor units and nothing else:
`{"price":{"amount_minor":1900,"currency":"USD"}}`. `{"amount_minor":19.00}` and
`{"amount_minor":"19.00"}` are both `422`.

### courier — port 4000

`/healthz` and `/readyz` sit at the root, **outside** `/api` and `/v1`, and are
exempt from the production SSL redirect: an orchestrator that gets a `301` to
https from `/healthz` reads `courier` as dead.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/v1/notification_preferences/{user_id}` | Read one recipient's preferences. |
| GET · POST | `/v1/webhook_endpoints` | List; register a subscriber URL. |
| GET · PATCH · DELETE | `/v1/webhook_endpoints/{id}` | Read; update; remove. |
| POST | `/v1/webhook_endpoints/{id}/test` | Send a signed test delivery. |

The `webhook_endpoints` scope sits behind its own authorization. The
notification-preferences routes are deliberately **outside** it: reading and
changing one recipient's preferences is not the same authority as registering a
destination the service will sign and dial on somebody else's behalf.

### muse — port 8000

| Method | Path | Auth | What it does |
| --- | --- | --- | --- |
| POST | `/v1/route` | bearer | Serve a chat completion from the first candidate provider that works. |
| GET | `/healthz` | none | Liveness. |
| GET | `/readyz` | none | Readiness. |

### guard — port 8080

`/v1/*` is the API surface (bearer JWTs, never a cookie) and `/auth/*` is the
browser surface (a `__Host-bff-session` cookie, and nothing else). They do not
cross.

| Method | Path | Auth | What it does |
| --- | --- | --- | --- |
| GET | `/healthz` | none | Liveness. Never rate limited. |
| GET | `/readyz` | none | Readiness. Never rate limited. |
| GET | `/v1/me` | bearer | `200` echoing the verified `{sub, scope, claims}`. Proves the chain; **forwards nothing**. |
| POST | `/auth/register` | same-origin | `201 {id, email}`. A registration is not a login — no session. |
| POST | `/auth/login` | same-origin | `200 {expires_at}` plus the `__Host-bff-session` cookie. |
| POST | `/auth/logout` | same-origin | `204`, cookie cleared. |
| GET | `/auth/me` | cookie | `200 {id, email}`, proxied to identity with the stored token. |

Rejections: `401` for a bad signature, an expired token, a wrong `iss` or
`aud`, a future `nbf`, a malformed token, or a `kid` identity does not publish.
`403` for a valid token without the scope a route needs. **`503` when identity's
key set is unreachable, unparseable, or slow** — that is the platform's outage,
not the caller's credential, and reporting it as `401` sends the caller to
re-authenticate against a healthy service.

## Who talks to whom

Drawn from the `dependencies` and `consumes` blocks of each `cafaye.yml`.
```
                    browser
                       │
                    parlor (3000) ──────────▶ identity  POST /v1/users
                       │                     identity  POST /v1/session
                       │                     identity  DELETE /v1/session
                       │                     identity  GET  /v1/me
                       ▼
                    guard (8080) ──────────▶ identity  /auth/*  (via IDENTITY_URL)
                       │
                       └── verifies tokens against identity's JWKS
                           (via IDENTITY_ISSUER, no call per request)

                   darkroom (8080) ───────▶ identity  JWKS only, no per-request call

   stripe ──signed──▶ billing (3000/80) ──out──▶ stripe   (Checkout, cancel, change plan)
                          │
                          └── outbox_events ──▶ (no publisher loop yet)

   muse (8000) ──declared dependency──▶ identity, guard
   courier (4000) ──declared dependency──▶ (none)  ──out──▶ subscriber webhooks
```

`muse` declares `identity` and `guard` as dependencies, which is what tells
`caf dev` and `pantry` to start them. `courier` and `billing` declare none —
they depend on Postgres, not on a sibling service.

**`guard` proxies nothing yet.** Its dependency on `identity` is real (it dials
it for `/auth/*` and fetches its JWKS) but no request is routed to any cafaye
service. The thing that decides where a path goes does not exist — `pantry`
answers *what a service is*, not *where a path goes*.

## What is not wired yet

Every one of these is a fact about the current code, not a plan. Each is also
the reason one of the [runbooks](/runbooks/) reads the way it does.

| Gap | Consequence for an operator |
| --- | --- |
| **No broker.** No service starts an outbox publisher loop. `identity`'s only `Publisher` is a no-op, on purpose. | Events accumulate in `outbox_events` unpublished. No cross-service reaction happens. Alert on the age of the oldest unpublished row. |
| **`guard` routes nothing.** | `/v1/me` proves auth and forwards nothing. There is no path-based routing behind the gateway. |
| **`guard` sessions are per process.** The `SessionStore` is a `Map`, and Redis does not change that. | A browser's session dies with the replica it signed in on, and is lost on restart. This is the "login loops back to the sign-in page" entry in [troubleshooting](/troubleshooting/), and it is why one replica is still the right answer for `guard`. |
| **`identity` has no OIDC refresh tokens, admin API or scoped API tokens.** Each is absent from the discovery document rather than stubbed. | Access tokens live fifteen minutes and cannot be renewed. MFA *is* built, but `MFA_ENCRYPTION_KEY` must be supplied — unset and the management routes are absent. |
| **`identity`'s password reset and email verification are built, published and unconfigured by default** — an earlier version of this table claimed they were absent from the discovery document, and they are not: all five recovery paths are in `identity/openapi/v1.yaml` and `site` implements the flow. | The recovery surface is mounted only with a mailer behind it, so without `COURIER_BASE_URL`, `COURIER_TOKEN` and `PASSWORD_RESET_LINK_TEMPLATE` the routes answer **503** rather than 404. A deployment should still have somebody on the other end of a support channel. |
| **`muse` auth is a stub.** | The bearer header's presence is checked and the token is not verified. Do not put `muse` behind anything you care about. |
| **No vault key rotation.** `key_version` exists in the table and is always 1. | `MUSE_VAULT_KEY` cannot be rotated in place. See [rotating secrets](/runbooks/secret-rotation/) for what that means today. |
| **`courier` publishes one event.** Only `courier.email.delivered`. The other four declared types need a provider webhook that is a later packet. | A bounced or complained address is not yet visible anywhere, and suppression is not yet automatic. |
| **`parlor`'s manifest does not validate,** and there is no admin surface and no Playwright suite. | `caf contract lint` is red on it, and the shell is not a finished template to clone. |
| **No collector is deployed.** `courier`, `billing`, `identity` and `muse` each export traces, and nothing is running to receive them. The stack is shipped by `kit` and `bin/dev` runs it, so the gap is a deployment step rather than a missing component. | You have no fleet-wide trace or error view until you run it. `muse` is not on core's `error.type` vocabulary, so do not group a cross-service error panel on that attribute. See [Observability](/observability/). |
| **No TLS termination in the services.** | `identity` binds plain HTTP. Terminate TLS at the edge, and note that `guard`'s default issuer is already an `https://` origin. |

## Cross-repo drift audit

`caf contract lint` finds the mechanical part of this, and it was **run against
the workspace**, not recalled:

```sh
cd cafaye/caf && go run ./cmd/caf contract lint /path/to/cafaye
```

On the current tree, run on 2026-09-30: **every repository valid except one.**
`parlor` fails:

| Repository | What the linter says |
| --- | --- |
| `parlor` | `is missing required fields ["name", "language", "core", "repository", "owner"]` |

`parlor`'s manifest is still the pre-`core` `apiVersion: cafaye/v0-draft` shape
with no `name` at the top level. It is documentation of intent, and it does not
validate.

**The manifest *count* moves and the answer does not.** This run reported 31
manifests: 26 `OK`, 5 `INVALID`, exit 1. Only one of the five is a defect:

| Invalid manifest | Is it a defect |
| --- | --- |
| `parlor/cafaye.yml` | **yes** — the shape above |
| `parlor-worker-parlor-05/cafaye.yml` | the same file in a worker worktree beside it |
| `core/harness/tests/fixtures/nonconforming/cafaye.yml` | **no — it exists to fail.** The directory is named `nonconforming` and the file breaks the name rule on purpose. |
| `core/harness/tests/fixtures/nonconforming-conventions/cafaye.yml` | no — it declares another service's event prefix on purpose |
| `core/harness/tests/fixtures/unsupported-yaml/cafaye.yml` | no — it declares an unknown key on purpose |

Three of the five are **negative fixtures for `core`'s own conformance tests**,
tracked on `core`'s `master`, and the linter is correctly reporting them as what
they are. That is why the raw count is worthless as a health signal: three of
the five permanent failures are files whose entire purpose is to be rejected,
and the fifth disappears when a worker worktree closes. Quote *which
repositories* fail, never *how many manifests*. Across the twelve primary
checkouts that have a manifest — `kit` has none, and `caf contract lint kit`
exits 1 saying `no cafaye.yml found` — the answer is one: `parlor`.

**Two repositories that used to fail here no longer do, and this page said
otherwise until now.** `caf`'s manifest gained its required fields, and
`courier`'s five event types were corrected from the two-segment form
(`email.queued`) to the three-segment one (`courier.email.queued`) — `courier`
caught this itself with `caf contract lint` and renamed them. That rename changes
the `type` on events already on the bus; [Upgrading](/upgrading/) has the order to
move your consumers in.

Verify against your own checkout rather than trusting this table. A drift audit
nobody re-runs is a changelog with a table in it.

### The drift a *different* linter can see

`caf contract lint` reads manifests, so it says nothing about which container a
service runs its database in. `kit`'s fleet gate does, and it was **run against
the workspace** rather than recalled:

```sh
cd cafaye/kit && .venv/bin/python tests/fleet_check.py --kit . --repos-dir ../
```

On the current tree it exits 0 and names six findings across three
repositories, and **four of the six are about the database**:

| Repository | What the gate says |
| --- | --- |
| `darkroom` | Its `postgres` service runs `postgres:17-alpine`, "which is the image kit's stack already ships". A service does not get its own copy of the shared infrastructure: it joins kit's, and its own file becomes an override beside the fetched stack. |
| `darkroom` | It publishes `5432:5432` in a file that is **merged** with the fetched stack, not substituted for it — compose appends a second file's `ports:` list, so the repository ends up with postgres on kit's port *and* on 5432. |
| `muse` | Its `db` service runs `postgres:17-alpine`, the same finding under a different service name. |
| `darkroom`, `guard`, `muse` | No `kit.ref`, so none of them has said which bytes of `kit` it runs. |

**These are warnings, not failures, and the reason is in the gate's own output:**
a finding inside a repository that *has* a `kit.ref` is a `FAIL`, and inside one
that has not adopted the stack it is a named `WARN` that leaves the run green.
All three named repositories are in the second case. **The two that matter here
are the Postgres ones**, and they are why the Database column above separates
`darkroom` and `muse` from the other three: the shared cluster exists, and those
two are still running their own copy of it.

**That is a finding against the service repositories, not against this page, and
it is not fixed here** — `darkroom` and `muse` are read-only from
`architecture/topology`.

### The drift the linter cannot see

All of these are real, and none of them is a lint failure. They are recorded here
because a reader will hit one.

| Where | What |
| --- | --- |
| `core/fleet.yml` | Transcribed at the commits named on each row, and **three of those have moved since**. `identity`'s manifest now declares `identity.oidc_client.created` and `.revoked`; `courier`'s `manifestViolations` list still records the two-segment spellings `courier` has since fixed. `fleet.yml` is the file `caf contract lint` reads for the catalog, so a stale copy is a stale catalog answer. |
| `identity`'s emitted events | It declares **five** types — `identity.user.created`, `identity.oidc_client.created`, `identity.oidc_client.revoked`, `identity.mfa.enabled`, `identity.mfa.disabled` — and writes **ten**. `identity.account.created`, `identity.member.invited`, `identity.member.accepted`, `identity.member.role_changed` and `identity.member.removed` are written and **declared in none of them**. Of the ten, only `identity.user.created` has a payload schema in core; six more have a catalog row and no schema. |
| `identity.member.accepted`, `identity.oidc_client.created` / `.revoked` | **No catalog row and no payload schema in core at all.** `accepted` is also not core's spelling — core's catalog row says `identity.member.joined`, and `accepted` is not in core's action vocabulary. The two OIDC types are advertised in the manifest with no published contract behind them, which is the exact gap core's catalog assertions exist to close. |
| `billing`'s subscription and plan payloads | `billing` emits its own ids; core's schemas describe the processor's. `billing`'s own contract test lists the four missing and four unexpected fields rather than absorbing them. See [Upgrading](/upgrading/#2-billingsubscriptionstarted-no-longer-declares-cafaye-prefixed-ids). |
| `courier`, `guard`, `identity` | Still pin `core: ^0.1.0`, which does not admit the `0.2` spec several of them compile against. Every service has to move at the same time, so the pin is a manager's decision rather than a per-repo edit. |
| `courier`'s README | Calls the repository "the v0 scaffold… deliberately no notification logic yet" and lists Swoosh, preferences, Oban and outbound webhooks as "not here yet". All of them landed. The manifest in the same repository is current; the prose above it is not. |
| `identity`'s README | Opens with "**v0 is a skeleton.** There is no auth logic here yet", which stopped being true several packets ago. Its "Not built yet" list further down is current. |
| `pantry`'s README | Says "the cafaye repositories are private, so a hosted runner cannot clone them", which contradicts the org being public. It is also the stated reason its `workspace-drift` CI job is disabled rather than merely absent. |
| `GET /v1/accounts/{id}/members` | Returns only each member's `role`; `account_id`, `user_id` and `created_at` come back empty. The membership is correct — verify with the member's own token instead. |
| `identity`'s migrations | `goose up` is a **prerequisite** for the OIDC tests, not a nicety. Without it they fail with `relation "public.oidc_clients" does not exist` — an error naming a relation rather than the missing step. |
