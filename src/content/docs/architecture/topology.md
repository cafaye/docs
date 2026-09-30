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

## The table

| Service | Language | Container port | Local port | Database | `core:` |
| --- | --- | --- | --- | --- | --- |
| `identity` | Go | 8080 | 8080 | Postgres 17, own database | `^0.1.0` |
| `billing` | Ruby | 80 | 3000 (host `bin/rails server`) | Postgres 17, own database | `^0.2.0` |
| `courier` | Elixir | 4000 | 4000 | Postgres 17, own database | `^0.1.0` |
| `muse` | Python | 8000 | 8000 | Postgres 18, own database | `^0.2.0` |
| `guard` | TypeScript (Bun) | 8080 | 8080 | **none** | `^0.1.0` |
| `parlor` | Next.js | 3000 | 3000 | **none** | *manifest is a pre-`core` draft* |
| `darkroom` | Rust | — | — | — | *no manifest; the repository is empty* |

`identity` and `guard` both want host port 8080. `identity`, `billing`, and
`courier` all publish Postgres on host 5432 (`muse` uses 5433). On one machine,
run them one at a time or remap the host side — the compose files take
`POSTGRES_PORT` where the repository offers it.

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
| `muse` | `GET /healthz` → consults nothing | `GET /readyz` | reports the `db` slot |
| `guard` | `GET /healthz` → always 200 | `GET /readyz` | 503 if a registered probe is down |
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

### guard

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Listen port. |
| `IDENTITY_ISSUER` | `https://identity.localhost` | Issuer-only base URL. `guard` appends `/.well-known/jwks.json` itself. Also the expected `iss`. |
| `IDENTITY_JWKS_URL` | derived from the issuer | Full key-set URL, for a key set served anywhere other than the issuer's well-known path. |
| `IDENTITY_JWKS_TTL_MS` | `300000` | How long a fetched key set is reused. **Also the revocation window.** |
| `GUARD_CLIENT_ID` | `guard` | The `aud` guard accepts. |
| `IDENTITY_URL` | `http://localhost:8080` | identity's base URL for the `/auth` **calls** — where a session is *requested*. |

`IDENTITY_URL` is a second variable for one service on purpose. The issuer is
an https origin in every environment; the address `guard` *dials* is a service
name, and inside a container `localhost` is `guard` itself. Leave it unset in a
container and you get a gateway asking itself for a session.

An empty or whitespace-only value counts as unset. A malformed one is a startup
error, never a silent default: `IDENTITY_JWKS_TTL_MS=soon` refuses to boot
rather than quietly fetching identity on every request.

### billing

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | — | Postgres DSN. |
| `STRIPE_WEBHOOK_SECRET` | — | The Stripe endpoint signing secret. |
| `STRIPE_WEBHOOK_SECRETS` | — | **Comma-separated list** of signing secrets, tried in order. This is the rotation path; see [rotating secrets](/runbooks/secret-rotation/). |
| `STRIPE_WEBHOOK_TOLERANCE` | `300` | Signature timestamp tolerance, in seconds. |

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

Generate a vault key with the module's own entry point:

```sh
uv run python -m muse.vault
```

There is no default and no fallback, and that is the design: a vault that boots
with a fallback key is a vault whose keys are readable by anyone who has read
the source. An empty, non-base64, or wrong-length value is a boot failure, and
the error names the variable and never its value — a variable's value in a boot
error is a credential in whatever the operator pastes the error into.

## HTTP surfaces

What each service answers today. `identity`'s `/v1/accounts` routes are
registered in code but **not yet in its OpenAPI document**, which currently
covers only `/v1/users`, `/v1/session`, `/v1/me`, `/healthz`, `/readyz`.

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

Roles are `owner`, `admin`, `member` — a PostgreSQL enum, ordered, and the
ordering is what `AtLeast` compares.

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
| POST | `/v1/webhooks/stripe` | **Stripe signature** | Payment-processor events in. |

Money crosses the wire as integer minor units and nothing else:
`{"price":{"amount_minor":1900,"currency":"USD"}}`. `{"amount_minor":19.00}` and
`{"amount_minor":"19.00"}` are both `422`.

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

   stripe ──signed──▶ billing (3000/80)      billing ──▶ Postgres (own)
                          │
                          └── outbox_events ──▶ (no publisher loop yet)

   muse (8000) ──declared dependency──▶ identity, guard
   courier (4000) ──declared dependency──▶ (none)
   darkroom ──does not exist
```

`muse` declares `identity` and `guard` as dependencies, which is what tells
`caf dev` and `pantry` to start them. `courier` and `billing` declare none —
they depend on Postgres, not on a sibling service.

**`guard` proxies nothing yet.** Its dependency on `identity` is real (it dials
it for `/auth/*` and fetches its JWKS) but no request is routed to any cafaye
service. The service registry that decides where a path goes does not exist.

## What is not wired yet

Every one of these is a fact about the current code, not a plan. Each is also
the reason one of the [runbooks](/runbooks/) reads the way it does.

| Gap | Consequence for an operator |
| --- | --- |
| **No broker.** No service starts an outbox publisher loop. `identity`'s only `Publisher` is a no-op, on purpose. | Events accumulate in `outbox_events` unpublished. No cross-service reaction happens. Alert on the age of the oldest unpublished row. |
| **`guard` routes nothing.** | `/v1/me` proves auth and forwards nothing. There is no path-based routing, and no service registry. |
| **Rate limits are per process.** `guard`'s counters are a `Map` in one replica. | A client gets its allowance from *each* replica, and counts reset on restart. A single-replica deployment is the only one where the limit means what it says. |
| **Sessions are per process.** `guard`'s `SessionStore` is a `Map`. | A browser's session dies with the replica it signed in on, and is lost on restart. This is the "login loops back to the sign-in page" entry in [troubleshooting](/troubleshooting/). |
| **No MFA, no OIDC redirect, no API tokens, no admin API in `identity`.** | `guard` verifies a password login. There is no TOTP enrollment and no authorization-code flow. |
| **`muse` auth is a stub.** | The bearer header's presence is checked and the token is not verified. Do not put `muse` behind anything you care about. |
| **No vault key rotation.** `key_version` exists in the table and is always 1. | `MUSE_VAULT_KEY` cannot be rotated in place. See [rotating secrets](/runbooks/secret-rotation/) for what that means today. |
| **`billing` never calls Stripe.** | `processor`, `processor_product_id`, and `processor_price_id` are stored and returned, and all three are null in practice. There is no checkout, no portal, no subscription table. |
| **`courier` sends nothing.** | No Swoosh, no provider adapter, no job queue, no preference store. An invitation token has to be delivered by hand. |
| **No TLS termination in the services.** | `identity` binds plain HTTP. Terminate TLS at the edge, and note that `guard`'s default issuer is already an `https://` origin. |

## Manifest drift you may hit

`caf contract lint` is the tool that finds this, and on the current tree it
fails on three repositories. Recording it here because you will hit it, and
because a linter that is always red gets ignored:

| Repository | What the linter says |
| --- | --- |
| `caf` | `is missing required fields ["language", "core", "repository", "owner"]` |
| `courier` | `exposes/events/0: "email.queued" does not match "^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(_[a-z0-9]+)*\.[a-z][a-z0-9]*(_[a-z0-9]+)*$"` |
| `parlor` | `is missing required fields ["name", "language", "core", "repository", "owner"]` |

The `courier` one is a real disagreement, not a typo: its manifest uses the
two-segment form (`email.queued`) while the schema `caf` vendors requires three
(`courier.email.queued`). `core`'s catalog lists courier's events under a
`courier.` prefix. Fixing it is a decision about which spelling wins, and specs
are manager-owned — see [Contracts](/contracts/).

`parlor`'s manifest is still the pre-`core` `apiVersion: cafaye/v0-draft` shape
with no `name` at the top level. It is documentation of intent, and it does not
validate.

Verify against your own checkout rather than trusting this table:

```sh
caf contract lint /path/to/cafaye
```
