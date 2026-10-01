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

**First decide which machine you are talking to**, because the answer is not the
same command either way. The `docker` commands below are right for a local
stack on your own laptop and for a host you have SSH'd into; they are the wrong
tool against a Kamal deployment you are watching remotely, where the container
names are prefixed and `kamal` is what addresses them.

Ask the question the caller is asking, from outside. **Note the port collisions
first**, because they are not all the same kind: `identity`, `guard` and
`darkroom` all default to 8080, and `billing` and `parlor` both default to 3000.
A loop that probes one port twice finds one service and prints it twice, so the
loop below prints the port next to every answer and is written to be edited for
*your* deployment rather than trusted as a fleet scan.

```sh
for p in 8080:identity 3000:billing 4000:courier 8000:muse 3000:parlor; do
  port=${p%%:*}; name=${p##*:}
  printf '%-10s :%s  ' "$name" "$port"
  curl -s -m 5 -o /dev/null -w 'healthz=%{http_code} ' "http://localhost:$port/healthz" 2>/dev/null
  curl -s -m 5 -o /dev/null -w 'readyz=%{http_code}\n'  "http://localhost:$port/readyz" 2>/dev/null \
    || echo " (no answer)"
done

# the three that share 8080 - probe them one at a time
for p in 8080:identity 8080:guard 8080:darkroom; do
  port=${p%%:*}; name=${p##*:}
  printf '%-10s :%s  ' "$name" "$port"
  curl -s -m 5 -o /dev/null -w 'healthz=%{http_code} ' "http://localhost:$port/healthz"
  curl -s -m 5 -o /dev/null -w 'readyz=%{http_code}\n'  "http://localhost:$port/readyz"
done
```

`parlor` is the odd one in that list: a Next.js frontend with no database and no
dependency of its own, whose two probes exist to keep a proxy honest. If
`parlor` and `billing` are both up, **only one of them owns 3000** — and reading
a 503 there as "`parlor` is failing" is a guess about which process answered.
`parlor` answers `{"status":"ok","deps":"none"}`; `billing` names its check.

:::caution[Only three of the seven have a Compose stack you can bring up on its own]
`darkroom`, `muse` and `guard` do: each owns a complete `docker-compose.yml`, and
`docker compose up -d` works there. `darkroom`'s and `muse`'s carry their own
`postgres` container (`muse`'s is called `db`); `guard` has no database at all,
so its file declares one service. `muse` needs `MUSE_VAULT_KEY` set or compose
refuses to interpolate it, and `darkroom` needs nothing.

**`identity`, `courier` and `billing` do not.** Their `docker-compose.yml` is an
**override**, not a stack: it carries the service, its database name and role,
and its crash layer, and it deliberately contains no `image:` on `postgres`
because kit's fetched stack ships that container. Run alone it fails before it
starts anything:

```
service "postgres" has neither an image nor a build context specified: invalid compose project
```

(`courier` fails one step earlier, on a missing `COURIER_SECRET_BOX_KEY`.) **The
supported path for those three is `bin/dev`**, which every one of them carries:
it fetches kit's stack at the ref in `kit.ref` and merges your file beside it.
`docker compose up -d` in those repositories is a finding against this page, not
a thing that works.
:::

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

:::caution[`docker` addresses a daemon, not a fleet]
Every command in this step is a **local Docker daemon** command, so it is right
for a laptop stack and for a host you are already logged into, and wrong for a
Kamal deployment you are watching from somewhere else. Under Kamal the container
names carry the app and role as prefixes, and `kamal app ps` / `kamal app logs /
<service>` are the commands that address them by the name you already know.

**And nothing in the fleet is deployed through it yet** — that is covered in [the
backup runbook](/runbooks/backup-and-restore/). Three repositories carry a
`config/deploy.yml`: `identity` and `courier` have adopted kit's template (and
changed its `/up` proxy healthcheck to `/readyz` while they were there), and
`billing`'s is the stock Rails-generated file from its first commit with the whole
`proxy:` and `accessories:` blocks commented out. What **no** repository has is
`bin/drill`, and no `config/kamal-backup.yml` has ever run anywhere. So "the
deployment" is presently a container you started yourself, which is what makes
the local commands the right ones and the Kamal ones the shape to learn.
:::

**Did it fail to start?** Every service validates its environment at startup and
**fails rather than falling back to a default**, so a typo in a deployment is a
crash with a message, not a service listening on the wrong port. The ones you
will actually hit:

- `muse` refuses to start without `MUSE_VAULT_KEY`, or with one that is not
  base64 or does not decode to 32 bytes.
- `guard` refuses to start on a malformed `IDENTITY_JWKS_TTL_MS` (`0` or `soon`),
  or on a malformed `REDIS_URL` (`redis//redis`).
- `darkroom` refuses to start on an object-store configuration it cannot resolve:
  a real `DARKROOM_S3_REGION` on an R2 endpoint, or `region=auto` with no
  `DARKROOM_S3_ENDPOINT`, which would otherwise resolve `s3.amazonaws.com` and
  put your media in a bucket you did not choose.
- `courier` refuses to start **in production** unless `COURIER_MAIL_ADAPTER` is
  set to an adapter that can actually deliver, and refuses a secret box it does
  not have: `COURIER_SECRET_BOX_KEY` missing, or `COURIER_MAIL_ADAPTER` unset,
  or named `local`/`test`. **This refusal is the feature.** The adapter it
  replaced rendered messages into memory and returned a provider-shaped id
  without opening a socket, so a released courier accepted every send, wrote an
  outbox row, published `courier.email.delivered`, and mailed nobody — no error
  and no warning. A deploy that fails at boot is the cheapest version of that
  incident. Full list in [rotating secrets](/runbooks/secret-rotation/).

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

**Every service repository pins Postgres 17, and one used to say otherwise.**
`darkroom`, `muse` and — through `kit`'s stack — `identity`, `courier` and
`billing` all resolve to a 17-series image by declaration. `muse` **was** on
`postgres:18` and was moved down deliberately: a one-deploy-many-services
platform that carries two major versions carries two upgrade paths and a dump
from `muse` that will not restore into any other service's database. **If you
find a `DATABASE_URL` pointing at a Postgres 18 that you did not choose, that is
the thing to look at.** Note also that `muse` carries its own migration note —
Postgres majors have incompatible on-disk formats, so a developer with a real 18
data directory needs `pg_dump`/`pg_restore` or `docker compose down -v` first,
and 17 refuses such a directory verbatim rather than corrupting it.

**But the declaration is not what you get, and that is the half worth
remembering.** A `DATABASE_URL` pointing at the wrong server is a 503 from
readiness and a `role "…" does not exist` from `psql` — and the second message is
the one that tells you the port or the role is wrong, while the **first** tells
you nothing.

| Where | Image | How it was checked |
| --- | --- | --- |
| `darkroom`'s own stack | `postgres:17-alpine` | its compose file |
| `muse`'s own stack | `postgres:17-alpine` | its compose file — it moved off 18 onto the fleet standard |
| **`kit`'s stack, as `bin/dev up` actually starts it** | **`postgres:16.6-alpine`** | ran it; the container reports `16.6-alpine` |
| what `caf dev` renders | `postgres:16-alpine` | `caf dev --dry-run` on `identity` |

That third row is the one that bites. `kit`'s compose file writes
`image: postgres:${KIT_POSTGRES_TAG:-17-alpine}` — so 17 is the *default* — but
the `.env` that `bin/dev up` creates on a first run comes from `kit`'s
`.env.example`, and that file sets **`KIT_POSTGRES_TAG=16.6-alpine`**. The
default in the compose file is not the version you get.

**Why it matters beyond tidiness:** `pg_dump` refuses to dump from a server
newer than itself, and silently produces a subtly wrong dump against a much older
one. So a modern local `pg_dump` pointed at the 16.6 the stack hands you is the
*silent* direction, not the loud one. Check both numbers rather than assuming
they agree — `select version()` through the service's own `DATABASE_URL`, and
`pg_dump --version` on whatever is doing the dumping.

### Where each service's Postgres actually is

This is the table the rest of this section was getting wrong, so it is the
table to read. **It is not one Postgres per service**, and the difference
between the two groups is the whole reason two stacks collide:

| Service | How its stack is built | Postgres on the host |
| --- | --- | --- |
| `identity`, `courier`, `billing` | an **override** on `kit`'s stack, run with `bin/dev` | **15500** — `kit`'s container, one per project |
| `darkroom` | a standalone compose file that owns its Postgres | **5432** |
| `muse` | a standalone compose file that owns its `db` | **5433** |
| `guard`, `parlor` | no database at all | — |

**The consequence is a container collision, not a port collision.** The first
three share one Postgres container, and each one renames that container's
database: `identity` sets `POSTGRES_DB: identity`, `courier` sets
`POSTGRES_DB: courier`, `billing` sets `POSTGRES_DB: billing`. Compose merges
those environment overrides **last-one-wins**, so bringing two of them up in one
project silently gives both services a DSN pointing at whichever database won.
Measured, merging `identity`'s and `courier`'s compose files over `kit`'s:

```
  postgres:
    environment:
      POSTGRES_DB: courier          # identity's `identity` is simply gone
      POSTGRES_USER: courier
      POSTGRES_PASSWORD: courier
```

`identity` then answers `role "identity" does not exist`, and it looks exactly
like a bad password. **So: run one of `identity`, `courier` and `billing` at a
time**, and stop one with `bin/dev down` before starting the next.

`darkroom` on 5432 and `muse` on 5433 are genuinely separate containers and can
run alongside anything. If a host port bind fails, the message names which
service and which port — read it rather than assuming 5432 is occupied.

:::caution[`POSTGRES_PORT` is not a thing any more]
An older version of this page told you to move a service's Postgres with
`POSTGRES_PORT=5433 docker compose up -d`. **No compose file in the fleet reads
that variable** — the only `POSTGRES_PORT` anywhere is inside `identity`'s
`gate.yml` prose and `parlor`'s e2e stack's own `E2E_IDENTITY_POSTGRES_PORT` —
and there is no repository that publishes a Postgres host port you can move with
it anyway. The variable that exists is **`KIT_POSTGRES_PORT`**, it is `kit`'s
rather than a service's, it defaults to `15500`, and it is set in your `.env` —
not on the command line, and not per service. A service's own compose file may
not move it, because a second compose file's `ports:` list is *appended* rather
than substituted.

So the remedies that actually work are:

- **run the services one at a time**, which the table above makes necessary
  anyway; or
- **change kit's `KIT_POSTGRES_PORT`** in the `.env` `bin/dev` writes on first
  run, which moves the shared container and leaves the service files alone; or
- for `darkroom` specifically, **stop whatever holds 5432** before bringing it
  up. `darkroom`'s own README carries that warning, and its symptom is the
  misleading part: the container comes up **healthy** (its healthcheck is
  `pg_isready`, which reports a server accepting connections and does not
  authenticate) while your command reaches the *other* database and fails with
  `role "darkroom" does not exist`, which reads like a missing migration.
:::

**If a stack did not come up at all,** the failure is almost never the
database. `identity`, `courier` and `billing` cannot be started with a bare
`docker compose up`, because their compose files are overrides on `kit`'s and
contain no Postgres image of their own:

```
service "postgres" has neither an image nor a build context specified: invalid compose project
```

Use `bin/dev`. Two services also refuse to render at all until a required secret
is set, and that refusal is the correct message rather than a missing default:
`courier` needs `COURIER_SECRET_BOX_KEY` and `muse` needs `MUSE_VAULT_KEY`.
[Getting started](/getting-started/) has the per-service command that works.

:::caution[`bin/dev` brings the infrastructure up and then fails on those three services]
**This is a real, reproduced failure, and it is in the three repositories' own
compose files rather than in `kit`.** All three of `identity`, `courier` and
`billing` set their container log driver to syslog pointing at the collector —
quoted from `identity`'s compose file:

```
logging:
  driver: syslog
  options:
    syslog-address: "tcp://otel-collector:15514"
    tag: "identity"
```

**Docker resolves a log-driver address with the host's resolver, not the compose
network's.** `otel-collector` only exists inside the network, so the driver
cannot reach it and the container never starts. Every other container in the
stack comes up healthy first — Postgres, NATS, Redis, the collector, Grafana,
Tempo, Loki, Mimir — and then this, with nothing about the database in it:

```
Error response from daemon: failed to create task for container:
failed to initialize logging driver: dial tcp: lookup otel-collector on
0.250.250.200:53: no such host
```

It is not a cafaye configuration problem, and it does not need cafaye to
reproduce:

```sh
docker run --rm --log-driver syslog \
  --log-opt syslog-address=tcp://otel-collector:15514 alpine:3 echo hi
```

**So today the infrastructure is up and the service is not, and the port answers
nothing.** Do not read that as "the service crashed": there is no container to
crash, no log to read and no readiness body to interpret. Read this message, or
start the service with the `logging:` block removed from a local copy of the
compose file. **A finding against `identity`, `courier` and `billing`, not a
workaround to keep.**
:::

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

**`$SERVICE` is not the container name**, and that is a quiet trap rather than a
loud one. Compose names a container `<project>-<service>-1`, and the project is
not the repository: `kit`'s stack sets `name: ${KIT_STACK_NAME:-cafaye}`, so
`identity` run through `bin/dev` gives you **`cafaye-identity-1`** and its
database is **`cafaye-postgres-1`**. `docker logs identity` says `No such
container`, which reads like "it is not running" rather than "you named it
wrong". Resolve it first:

```sh
docker ps -a --filter "name=$SERVICE" --format '{{.Names}}'
```

On a machine you are SSH'd into, the two `docker` lines are the ones to swap for
`kamal app ps` and `kamal app logs / $SERVICE`; the three `curl`/`psql` lines are
the same either way.
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
