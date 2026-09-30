---
title: A Service Is Down
description: How to tell which service is down, what to check, and what not to do while you find out.
---

You have a 5xx, a 503, a timeout, or nothing at all. The first job is not to fix
it — it is to work out **which** service is down and **what kind** of down, in
the fewest possible round trips. Restarting something to see what happens
destroys the evidence and, on a multi-replica deployment, can turn a degraded
service into a down one.

## The rule that shapes this page

**Liveness and readiness are separate, and the split is the same rule in every
service: liveness answers whenever the process can dispatch, so a dependency
outage never restarts the container. Only readiness is allowed to go 503 because
something else is down.**

So the very first question is not *is it up* but **which probe**:

| `GET /healthz` | `GET /readyz` | Meaning | Action |
| --- | --- | --- | --- |
| 200 | 200 | healthy | — |
| 200 | **503** | **the process is fine, a dependency is not** | go to step 3 |
| **connection refused / timeout** | — | the process is not answering | go to step 2 |
| 200 | 200, but the **app** is broken | the probes do not cover it | go to step 4 |

**Restarting a service whose `/healthz` is 200 and whose `/readyz` is 503 makes
the outage worse**, and it is the most common wrong move. The process is
healthy; a database or a peer is not. Restarting replaces a warm connection pool
with a cold one, drops in-flight work, and does not touch the actual cause.

## Step 1 — which service?

Ask the question the caller is asking, from outside. **Note the port collisions
first**: `identity`, `guard` and `darkroom` all default to 8080, so on a laptop
the loop below only ever finds one of them. That is why it is written to be
edited for *your* deployment rather than trusted as a fleet scan.

```sh
for p in 8080:identity 3000:billing 4000:courier 8000:muse 3000:parlor; do
  port=${p%%:*}; name=${p##*:}
  printf '%-10s ' "$name"
  curl -s -m 5 -o /dev/null -w 'healthz=%{http_code} ' "http://localhost:$port/healthz" 2>/dev/null
  curl -s -m 5 -o /dev/null -w 'readyz=%{http_code}\n'  "http://localhost:$port/readyz" 2>/dev/null \
    || echo " (no answer)"
done

# the three that share 8080 - probe them one at a time
for p in 8080:identity 8080:guard 8080:darkroom; do
  port=${p%%:*}; name=${p##*:}
  printf '%-10s ' "$name"
  curl -s -m 5 -o /dev/null -w 'healthz=%{http_code} ' "http://localhost:$port/healthz"
  curl -s -m 5 -o /dev/null -w 'readyz=%{http_code}\n'  "http://localhost:$port/readyz"
done
```

Then the dependency direction, which is short and worth memorising:

```
parlor   ──▶ identity
guard    ──▶ identity        (dials it for /auth/*, fetches its JWKS)
darkroom ──▶ identity        (JWKS only - verifies locally, no call per request)
muse     ──▶ identity, guard  (declared dependencies)
billing  ──▶ Postgres, and out to Stripe
courier  ──▶ Postgres, and out to subscriber webhooks
guard    ──▶ nothing         (no database)
```

`guard` returning 503 on `/v1/*` almost always means `identity` is unreachable —
and that is a **different** 503 from a database one, because `guard` deliberately
distinguishes them. `identity` returning 503 on `/readyz` means Postgres.

## Step 2 — the process is not answering

Connection refused, or a timeout. In order:

**Is the container running?**

```sh
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
```

`Restarting (1) 30 seconds ago` is a crash loop, and the exit code is the
question. `docker logs --tail 100 <name>` is where the answer is.

**Did it fail to start?** Every service validates its environment at startup and
**fails rather than falling back to a default**, so a typo in a deployment is a
crash with a message, not a service listening on the wrong port. The two you
will actually hit:

- `muse` refuses to start without `MUSE_VAULT_KEY`, or with one that is not
  base64 or does not decode to 32 bytes.
- `guard` refuses to start on a malformed `IDENTITY_JWKS_TTL_MS` (`0` or `soon`),
  or on a malformed `REDIS_URL` (`redis//redis`).
- `darkroom` refuses to start on an object-store configuration it cannot resolve:
  a real `DARKROOM_S3_REGION` on an R2 endpoint, or `region=auto` with no
  `DARKROOM_S3_ENDPOINT`, which would otherwise resolve `s3.amazonaws.com` and
  put your media in a bucket you did not choose.

**Is it listening on the port you are probing?** `identity`, `guard` and
`darkroom` all default to 8080, and the image listens on what `PORT` says. A
container running with `PORT=9000` is healthy and unreachable at 8080.

**Did a migration run against it?** No service migrates on boot, so a schema
mismatch shows up as a runtime error rather than a start-up one. If you just
deployed, check `goose … status` or `bin/rails db:prepare` before you restart
anything.

**Are the images distroless with no shell?** `identity`'s image is
`gcr.io/distroless/static-debian12:nonroot`, uid 65532, no shell. You **cannot**
`docker exec sh` into it. That is deliberate, and it means the probes and the
logs are the only two tools you have. Do not rebuild an image with a shell in it
to debug something.

## Step 3 — `/healthz` is 200 and `/readyz` is 503

The process is healthy and a dependency is not. **Do not restart.**

### The reason is in the logs, not in the response

Probe failures are logged with the underlying error and **never returned to the
caller** — an unauthenticated `GET /readyz` must not be a way to learn that the
database is at `10.0.0.5` or that a password was rejected. So a bare 503 with no
detail is the design working, and the detail is in the service's log:

```sh
docker logs --tail 200 <name> 2>&1 | grep -i -E 'ready|probe|depend|database|error'
```

### identity — `{"status":"ok","deps":"none"}` versus `deps: "postgres"`

Three distinct states, and the middle one is the common trap:

| `/readyz` | Meaning |
| --- | --- |
| `{"status":"ok","deps":"none"}` | `DATABASE_URL` is unset. **No pool, no readiness dependency, and no `/v1` routes registered at all.** Every `/v1` call is a `404`. |
| `{"status":"ok","deps":"postgres"}` | healthy, with a database |
| `503 {"status":"unavailable",…}` | the pool cannot reach Postgres; each probe bounded at 2s |

`deps: "none"` looks like the healthiest answer on the page and is the one that
breaks everything. If the symptom is "`/v1/users` returns 404", this is why, and
it is a missing environment variable rather than a missing route.

The `/v1` routes are conditionally registered **on purpose**: a missing database
is a clear `404` rather than a pile of `500`s.

### billing — `{"status":"error","checks":{"database":"error"}}`

Its readiness names the check that failed. Same cause as identity's 503, reached
through Rails instead. `/healthz` and `/up` are both always-200, so check
`/readyz`, not `/healthz`, when you are deciding whether to send traffic.

### courier — the slow 503

With a database that has gone away underneath a running pool, `/readyz` takes
about **4.4 seconds** to answer 503. That is the pool's queue backpressure, not
the query timeout, and it is documented in `Courier.Health`.

**If your orchestrator's probe timeout is under 5 seconds, it will time out and
read `courier` as not ready** — the same verdict, arrived at by the wrong route,
with a probe timeout in your logs that looks like an unrelated misconfiguration.
Raise the probe timeout before you investigate anything else. Restarting
`courier` here fixes nothing: the database is still gone.

### guard — 503 means identity, not guard

`guard` returns 503 when identity's key set is **unreachable, unparseable, or
slow**. That is the platform's outage, not the caller's credential, and the
distinction is deliberate: reporting it as `401` sends every caller to
re-authenticate against a healthy service.

Check the two variables, which are different on purpose:

| Variable | Default | What it is for |
| --- | --- | --- |
| `IDENTITY_ISSUER` | `https://identity.localhost` | Issuer-only base URL. `guard` appends `/.well-known/jwks.json` itself. Also the expected `iss`. |
| `IDENTITY_URL` | `http://localhost:8080` | identity's base URL for the `/auth` **calls**. |

**Inside a container, `localhost` is `guard` itself.** An unset `IDENTITY_URL` in
a container is a gateway asking itself for a session, and the symptom is a 503
or a hang rather than anything that names the variable. The compose file sets it
explicitly for exactly this reason.

Note also that the key set is cached for `IDENTITY_JWKS_TTL_MS` (default
`300000` — five minutes). **`guard` will keep verifying tokens signed with a key
identity has withdrawn until that cache expires.** During a rotation or a
withdrawal, allow five minutes before concluding a change had no effect.

### guard — a 503 that names Redis

`guard` treats Redis as a **registered readiness dependency** when `REDIS_URL` is
set, so `/readyz` reports it by name:

```json
{"deps":{"identity":"ok","redis":"unavailable"}}
```

**This is not a request failure.** The connection is opened lazily, and an
unavailable Redis is a logged-and-reported condition rather than a blanket `429`
for every caller — failing closed would hand one outage to every request on the
platform. If you set `REDIS_URL` and the rate limiter looks like it is not
limiting, check the readiness body before you check the limiter.

## Step 4 — both probes are 200 and the application is broken

The probes cover liveness and the registered dependencies. They do not cover
everything, and there are two known cases in this platform.

**Sessions die on a restart or a second replica.** `guard`'s session store is a
`Map` in one process. A browser signed in on replica A gets a cookie that
replica B has never heard of. The symptom is a login loop: `/auth/login` returns
`200` with a fresh cookie and `/auth/me` answers 401 on the next request.
**Run one replica, or treat this as a known limitation** — the `SessionStore`
interface is the seam and a shared store is a later packet. Setting `REDIS_URL`
does **not** fix this; it fixes the counters only.

**Rate limits mean different things depending on `REDIS_URL`.** Unset, the
counters are one process's memory: a client gets its allowance from *each*
replica, and every restart resets it. Set, they are shared by every replica and
survive a restart — but the **Redis path is driven in tests by a transcription of
the Lua script, not by a live `redis-server`**, so a first run against real Redis
is worth watching.

**The limiter reads `X-Forwarded-For` from the right, if you tell it how many
proxies to believe.** `TRUSTED_PROXIES=n` means *n* proxies append to the chain,
and the address is read at that hop counting from the end; everything to the left
is something the caller wrote. `TRUSTED_PROXIES=0` — the default — believes none
of the header and keys on the socket peer. **If you are behind a proxy and left
this at `0`, every caller shares one bucket** and your limit is effectively
global; if you set it too high, a caller can mint a fresh allowance per request.
A chain shorter than the trusted run falls back to the socket peer, because a
bucket that groups too many callers is the direction to be wrong in.

**`muse` returns 401 for a credential it cannot decrypt.** If you rotated
`MUSE_VAULT_KEY`, every stored provider credential fails to decrypt, and it
surfaces as a `401` rather than a `500` so it does not read as a wrong upstream
key. It is a vault-key problem, not a provider problem. See [rotating
secrets](/runbooks/secret-rotation/).

**`darkroom`'s object storage is a separate failure from its database.** Its
`/readyz` really runs a query, so a healthy 200 means the database is reachable —
and says nothing about the bucket. A completion that returns `409 object absent`
or `422 checksum mismatch` is an object-store problem: check the endpoint, the
region and the credential, not the service. See [darkroom](/services/darkroom/).

**Nothing reacts to anything.** No service starts an outbox publisher loop, so
`identity`, `billing`, `muse`, `courier` and `darkroom` all record events and
deliver none. If the symptom is "the write succeeded and the other service did
not notice", that is the platform's current state and not an outage. See
[architecture](/architecture/#the-write-path-in-full).

## Step 5 — the Postgres version skew trap

A service that is fine and a database that is not can look like a service
outage. `pg_dump` from a newer server than your client refuses outright, and
`goose` and Rails migrations both fail against a server they do not expect.

```sh
psql "$DATABASE_URL" -c 'select version();'
docker exec <pg-container> psql -U <superuser> -d postgres -c 'select version();'
```

`identity`'s compose stack is `postgres:17-alpine`; `muse`'s is
`postgres:18-alpine`. A `DATABASE_URL` pointing at the wrong one is a 503 from
readiness and a `role "…" does not exist` from `psql` — and the second message is
the one that tells you the port is wrong.

**A very common specific case:** the host port bind fails because something else
holds 5432, and a host-side DSN then silently reaches the *other* Postgres. Four
of the repositories publish 5432 (`identity`, `billing`, `courier`,
`darkroom`); `muse` already defaults to 5433. The compose files take
`POSTGRES_PORT` where the repository offers it
(`POSTGRES_PORT=5433 docker compose up -d`); where it does not, run one service
at a time.

## What not to do

- **Do not restart a service whose `/healthz` is 200.** Its dependency is down.
  Restarting drops a warm pool and in-flight work and fixes nothing.
- **Do not `docker exec sh` into a service image.** There is no shell, and that
  is the point. The probes and the logs are the tools.
- **Do not add a shell, a debugger, or a package manager to a service image to
  debug it.** An image with a compiler in it is an image with a supply chain in
  it, and the distroless shape is a deliberate control.
- **Do not roll back a migration to fix a 503.** Take a backup first. `identity`'s
  migration README is explicit: a `Down` exercised during an incident is a first
  resort, not a plan.
- **Do not widen `IDENTITY_JWKS_TTL_MS` to "fix" a stale key problem** without
  understanding that it is also the revocation window. Lower it, don't raise it.
- **Do not treat `deps: "none"` as healthy.** It is the answer from a service with
  no database, and it reads exactly like success.
- **Do not delete the `outbox_events` rows to make a backlog look better.** An
  outbox nobody prunes is the largest table in the database, and the reason
  someone eventually deletes rows that were never published. Rows with
  `published_at is null` are an incident to investigate, not litter to clear.

## Escalating: what to capture before you restart anything

Whatever you are about to do, capture this first — it is the difference between a
five-minute fix and a postmortem:

```sh
date -u
curl -s -m 5 -i "$SERVICE/healthz"
curl -s -m 5 -i "$SERVICE/readyz"
docker ps --format '{{.Names}}\t{{.Status}}' | grep "$SERVICE"
docker logs --since 30m "$SERVICE" 2>&1 | tail -200
psql "$DATABASE_URL" -c "select now(), pg_is_in_recovery();"
```

Then, for `identity` and `billing`, the outbox age — the one number that says
whether events are piling up:

```sql
select count(*) filter (where published_at is null) as unpublished,
       min(created_at) filter (where published_at is null) as oldest_unpublished
  from outbox_events;
```

## See also

- [Troubleshooting](/troubleshooting/) — the same material keyed by the symptom
  a user reports, rather than by the component.
- [Backup and restore](/runbooks/backup-and-restore/) — when the answer is
  "restore".
- [Rotating secrets](/runbooks/secret-rotation/) — the crash-on-startup cases.
- [Topology](/architecture/topology/) — every port, probe, and environment
  variable in one table.
- [Running the gates](/running-the-gates/) — when the answer is "run the suite
  before you restart anything".
