---
title: Getting Started
description: Install the caf CLI, validate a manifest, run a service locally, and deploy it to your own infrastructure.
---

This page is the path a design partner walks the first week: get a toolchain,
install the CLI, prove the contracts are sound, run a service against local
Postgres, and put that service on your own infrastructure. Every command below
was run against the real `caf` binary and the real service repositories, and the
output is quoted where it matters.

## Status, first

**cafaye is in early development.** Of the ten `caf` subcommands, **five** do
real work today — `version`, `doctor`, `dev`, `contract lint`, `contract
resolve`. The other five (`init`, `new`, `deploy`, `gen`, `mcp`) parse their
flags, check their argument count, and return `not implemented in v0`. That is
stated on every step below rather than hidden, because a command that silently
half-works is worse than one that refuses.

What *is* real: the [contracts](/contracts/) are frozen and validated, seven of
the eight `caf` subcommands you will reach for parse correctly, the services have
HTTP surfaces you can call, container images you can build, a local stack you can
run, and `caf dev` will render and bring up a compose file from a manifest. What
is not real: `caf deploy`, `caf gen`, and the broker. The
[runbooks](/runbooks/) assume you have already got the services running on your
own infrastructure.

## Step 1 — check the toolchain

`caf doctor` is the first command to run, and it is safe anywhere. It resolves
binaries on `PATH` and never executes them: no subprocess, no container, no
network.

```sh
go install github.com/cafaye/caf/cmd/caf@latest
caf doctor
```

```
tool            status  found at
git             ok      /opt/homebrew/bin/git
docker          ok      /usr/local/bin/docker
docker compose  ok      /usr/local/bin/docker-compose
tilt            ok      /Users/kaka/.local/share/mise/shims/tilt
go              ok      /Users/kaka/.local/share/mise/shims/go
ruby            ok      /Users/kaka/.local/share/mise/shims/ruby
elixir          ok      /Users/kaka/.local/share/mise/shims/elixir
python          ok      /Users/kaka/.local/share/mise/shims/python3
bun             ok      /Users/kaka/.local/share/mise/shims/bun
rust            ok      /Users/kaka/.cargo/bin/rustc
checked 10 tools, 10 ok, 0 missing
```

It checks ten tools, in that order: `git`, `docker`, `docker compose`, `tilt`,
`go`, `ruby`, `elixir`, `python` (looked up as `python3` then `python`), `bun`,
`rust` (`rustc` then `cargo`). That list is the `tools` table in
`caf/internal/cli/doctor.go`, one row each, in that order. `doctor`
**always exits 0** — it is a report about a machine, not a gate — so a `missing`
row is something you read, not a CI failure.

You do not need all ten. You need the languages of the services you intend to
run, plus `git` and `docker`. `identity` alone needs `go`; `parlor` needs `bun`.

Run it with no argument and, having no project to plan, it prints one line after
the table:

```
project .: no manifest: no cafaye.yml in .; a project declares its service in one
(run "caf init" to create it, or pass the project directory as the argument)
```

That is not a failure. Point it at a project directory to get the **second
table**, which is the one the first cannot answer — whether the container
runtime is *answering*, whether the machine has the memory and CPUs a stack
needs, whether the ports the stack publishes are free, and whether the
toolchain for the language in that project's `cafaye.yml` is installed:

```sh
caf doctor ../identity
```

```
project /path/to/identity: identity (go), 3 services in identity-dev
check              status  detail
container runtime  ok      /usr/local/bin/docker
runtime running    ok      server 29.4.0
memory             ok      16 GiB, need 4 GiB
cpu                ok      8, need 4
port 8080          free    -
toolchain go       ok      /Users/kaka/.local/share/mise/shims/go
checked 6 project checks, 6 ok
```

Three rows there are invisible from the tool table. `runtime running` asks the
Docker **server**, so an installed-but-stopped runtime reads `unreachable` while
the table above says `ok`. `memory` and `cpu` hold a floor of 4 GiB and 4 CPUs
for a database, a cache and a service at once. And the ports come from the same
plan `caf dev` would build, so the two cannot drift. `-tools-only` prints the
first table alone.

:::caution[What the check is not]
`doctor` proves a binary is on `PATH`. It does not prove the version, and in the
first table it cannot prove that Docker is *running* — only the second table can,
by asking the server. Every service repository pins its own toolchain in its own
`mise.toml`; `mise install` inside that repository is the versioned answer, and
this page does not repeat those pins.
:::

## Step 2 — install `caf`

There is no tagged release, so `@latest` resolves to a pseudo-version built
from `master`. That works today:

```sh
go install github.com/cafaye/caf/cmd/caf@latest
caf version
```

```
caf 0.0.0-dev (commit unknown)
```

That version string is not a mistake. The semver and commit are injected at link
time by the release pipeline; a `go install` from an untagged commit has
neither, so the binary reports the development identity. When a release lands,
`caf version` reports the release instead.

To build from a clone instead — which is what you want if you are going to read
the source:

```sh
git clone git@github.com:cafaye/caf.git
cd caf
go build ./cmd/caf
```

:::caution[`go build ./cmd/caf`, not `go build -o caf .`]
The main package is at `cmd/caf`. The repository root holds no Go files, so
`go build -o caf .` from the root fails with `no Go files in <path>` and exit 1.
`go build ./cmd/caf` writes `./caf` in the current directory. `go install
github.com/cafaye/caf/cmd/caf@latest` writes to `$GOBIN` instead.
:::

There is no Homebrew tap and no `caf install` command. `brew install
cafaye/tap/caf` and `caf install` are both
<span class="badge caution">Coming soon</span>; neither exists today, and neither
has a workaround beyond the two commands above.

## Step 3 — read what the CLI can do

```sh
caf help
```

```
caf - the cafaye platform CLI

Usage:
  caf <command> [flags] [arguments]
  caf help <command>

Commands:
  contract  validate cafaye manifests and resolve core version constraints
  deploy    deploy a service or app to the cafaye platform
  dev       run the local development stack
  doctor    report which cafaye toolchains this machine has
  gen       generate code and configuration from cafaye contracts
  init      create a cafaye.yml manifest for the current project
  mcp       serve the cafaye tools over the Model Context Protocol
  new       scaffold a new cafaye service or app
  version   print the caf version
  help      show help for a command
```

`caf help <command>` is the same as `<command> --help`, and it is the authority
on flags — this page does not restate them, because a flag list copied into
prose is a flag list that drifts.

| Command | Takes | Works today |
| --- | --- | --- |
| `caf version` | — | yes |
| `caf doctor` | 0 or 1 | yes |
| `caf contract lint <path>` | 1 argument | yes |
| `caf contract resolve <constraint> <version>` | 2 arguments | yes |
| `caf dev [project]` | 0 or 1 | yes |
| `caf init` | 0 arguments | flags only |
| `caf new <name>` | 1 argument | flags only |
| `caf deploy <service>` | 1 argument | flags only |
| `caf gen <target>` | 1 argument | flags only |
| `caf mcp` | 0 arguments | flags only |

*Flags only* means exactly what it says: the flags parse, the argument count is
checked, and the command returns `not implemented in v0` with exit code 1.

`doctor` and `dev` both take an **optional** path — `caf doctor` alone reports
the machine, and `caf doctor ./my-service` reports the machine *and* whether it
can run this particular project.

### Two things that will bite you

**`caf init` takes no positional argument.** It operates on a directory. This
is the argument-count check firing:

```
$ caf init my-saas
caf: usage: caf init wants 0 arguments, got 1 (usage: caf init [flags])
$ echo $?
2
```

The command that takes a name is `caf new`:

```
$ caf new my-saas
caf: caf new: not implemented in v0
$ echo $?
1
```

**Flags come before positional arguments.** `caf` uses Go's standard `flag`
package, so the flags must precede them:

```sh
caf deploy --dry-run identity     # works
caf deploy identity --dry-run     # usage error, exit 2
```

### Exit codes

These are a contract — scripts branch on them, so they do not change without a
version bump.

| Code | Meaning |
| --- | --- |
| 0 | the command succeeded, or you asked for help |
| 1 | the command ran and failed |
| 2 | `caf` was invoked wrongly: unknown command, unknown flag, wrong argument count |

## Step 4 — `caf init` a project

<span class="badge caution">Coming soon</span> — the flags parse, the command
returns `not implemented in v0`.

```
$ caf init
caf: caf init: not implemented in v0
$ echo $?
1
```

`caf init` is the command that will create a `cafaye.yml` for the current
project. It takes `-dir` (default `.`) and `-force`, and nothing else:

```sh
caf help init
```

```
caf init - create a cafaye.yml manifest for the current project

Usage:
  caf init [flags]

Flags:
  -dir string
        directory to initialize (default ".")
  -force
        overwrite an existing cafaye.yml
```

**Until it ships, write the manifest by hand.** Copy the shape from
[Contracts](/contracts/), then prove it with the one validator that does work.
`docs/cafaye.yml` is a complete, schema-valid example you can read in the
repository.

```sh
caf contract lint ./cafaye.yml
```

```
OK ./cafaye.yml
```

Point it at a directory and it walks the tree, checking every `cafaye.yml` it
finds and skipping `.git`, `node_modules`, `deps`, `_build`, and `target`:

```sh
caf contract lint /path/to/checkouts
```

```
OK /path/to/checkouts/billing/cafaye.yml
INVALID /path/to/checkouts/parlor/cafaye.yml: is missing required fields ["name", "language", "core", "repository", "owner"]
```

It prints one line per manifest and nothing else, so the output is greppable
and diffable. **It exits 1 if any manifest is invalid, and also if the path
holds no manifest at all** — a tree that validated nothing is not a pass:

```
$ caf contract lint /tmp/empty-dir
caf: caf contract lint: no cafaye.yml found under /tmp/empty-dir
```

Validation is two things: the core JSON Schema, vendored into the `caf` binary
at `internal/contract/schemas/manifest-0.2.json` and pinned by sha256 (`caf`
never fetches it), plus the three cross-field rules a JSON Schema cannot state —
a published event type must start with the publisher's own name, a service never
consumes its own events, and an `exposes` must name an OpenAPI document or an
event. The schema is checked first; the cross-field rules only run on a document
that passed it.

### Checking a core version constraint

`caf contract resolve` answers one question — does this service's `core:` range
admit this `core` release — and is shaped for a CI gate.

```sh
caf contract resolve '^0.2.0' 0.2.0
```

```
yes  ^0.2.0 allows 0.2.0: 0.2.0 is in [0.2.0, 0.3.0)
```

```sh
caf contract resolve '^0.1.0' 0.2.0
```

```
no   ^0.1.0 allows 0.2.0: 0.2.0 is not in [0.1.0, 0.2.0)
```

Exit 0 when the version is inside the constraint, 1 when it is not, 2 when
`caf` cannot read what you typed. The constraint grammar is deliberately tiny:
`1.2.3` exactly, `^1.2.3` caret, `~1.2.3` tilde, `>=1.2.3` at-or-above. No
ranges, no `||`, no `x`-ranges. Note the pre-1.0 caret: on a `0.x` service
`^0.2.0` is `>=0.2.0 <0.3.0`, so a `0.3.0` core is *not* admitted by
`^0.2.0`.

## Step 5 — run a service locally

`caf dev` **works.** It reads a project's `cafaye.yml`, validates it against the
same rules `caf contract lint` applies, renders a compose file from it, **writes
that file and prints it in full**, brings the stack up, waits for it, and reports
what came up and what did not.

```sh
caf dev --dry-run ./hello      # render and print; do not bring anything up
```

```
project hello-dev: hello (go)
skipped legacy: optional dependency, and the local registry does not know how to run it
wrote /work/hello/hello.compose.yaml
```

The report **is** the message: `caf dev` prints its verdict for a stack that came
up with something in it that did not, on stdout, once, and does not repeat it on
stderr. A generated compose file is marked *do not edit* — every run rewrites it,
and the manifest is the source of truth.

**What it does not do yet:** it plans from the manifest and the local registry, so
a dependency the registry does not know how to run is reported as `skipped`
rather than silently omitted. It does not deploy, and it does not start a broker —
nothing in the platform publishes events off the outbox.

:::caution[Not every service has a Compose stack you can bring up on its own]
`darkroom`, `muse` and `guard` ship a complete `docker-compose.yml`, and
`docker compose up -d` works in each of them (`muse` needs `MUSE_VAULT_KEY` set,
or compose refuses to interpolate it).

**`identity`, `courier` and `billing` do not.** Their `docker-compose.yml` is an
**override**, not a stack: the service, its database name and role, and the
crash layer — and deliberately **no `image:` on `postgres`**, because kit's
fetched stack ships that container. Run alone, it stops before starting anything:

```
service "postgres" has neither an image nor a build context specified: invalid compose project
```

(`courier` fails one step earlier still, on a missing
`COURIER_SECRET_BOX_KEY`.) **Those three use `bin/dev`**, which every one of them
carries: it fetches kit's stack at the ref in `kit.ref` and merges your file
beside it.
:::

With one that starts on its own, the shape is:

```sh
git clone git@github.com:cafaye/darkroom.git
cd darkroom
docker compose up -d postgres
curl -s localhost:8080/healthz
curl -s localhost:8080/readyz
```

```
{"status":"ok"}
{"status":"ok"}
```

For `identity` — the shortest example of the `bin/dev` shape — the database is
in kit's stack rather than the service's, and its readiness answer carries the
dependency by name:

```sh
git clone git@github.com:cafaye/identity.git
cd identity
bin/dev              # fetch kit at kit.ref, merge, up --wait, migrate, print URLs
curl -s localhost:8080/healthz
curl -s localhost:8080/readyz
```

```
{"status":"ok"}
{"status":"ok","deps":"postgres"}
```

Without a database `readyz` answers `{"status":"ok","deps":"none"}` — there is
nothing to check, and saying so beats an empty list that looks identical to a
healthy dependency check. The `/v1` routes are only registered when
`DATABASE_URL` is set, so a missing database is a clean `404` rather than a
pile of `500`s.

To run `identity` without Docker at all — the faster loop while you are changing
code, and it needs no database:

```sh
mise install          # reads identity/mise.toml -> the pinned Go
go run ./cmd/identity # http://localhost:8080
```

### The other services

| Service | Local stack | Port | What answers |
| --- | --- | --- | --- |
| `identity` | **`bin/dev`** (compose alone will not start) | 8080 | `{"status":"ok","deps":"postgres"}` |
| `billing` | **`bin/dev`**, then `bin/rails server` | 3000 | `{"status":"ok","checks":{"database":"ok"}}` |
| `courier` | **`bin/dev`**, or `mix phx.server` | 4000 | `{"status":"ok"}` |
| `darkroom` | `docker compose up -d postgres`, then `cargo run` | 8080 | `{"status":"ok"}` |
| `muse` | `docker compose up --build` (needs `MUSE_VAULT_KEY`) | 8000 | `{"status":"ok","deps":{"db":"ok"}}` |
| `guard` | `docker compose up -d --build` | 8080 | `{"deps":{…}}` |
| `parlor` | `bun run dev` | 3000 | `{"status":"ok","deps":"none"}` |

The three in bold are the ones whose `docker-compose.yml` is an override rather
than a stack. `parlor` has no compose file at all — it is a Next.js frontend and
`bun run dev` is the whole loop.

**Three port collisions to expect on a laptop:** `identity`, `guard` and
`darkroom` all want 8080, so run them one at a time.

**The Postgres host port is narrower than it used to be described.** Only
**`darkroom` (5432)** and **`muse` (5433)** publish a Postgres port on the host,
both as literals. `identity`, `courier` and `billing` publish **none** — their
databases are reachable over the compose network by service name, and kit's
fetched stack publishes its own on `KIT_POSTGRES_PORT` (default `15500`).

**There is no `POSTGRES_PORT` variable to set.** No service repository reads one;
the only `POSTGRES_PORT` in the fleet is inside `identity`'s `gate.yml` prose and
`parlor`'s e2e stack's own `E2E_IDENTITY_POSTGRES_PORT`. A previous version of
this page told you to remap with `POSTGRES_PORT=5433 docker compose up -d` — that
does nothing. The variable that exists is **`KIT_POSTGRES_PORT`**, it lives in
**kit's `.env`**, and it moves kit's shared container rather than any service's.

The trap worth knowing is `darkroom`'s: its Postgres binds host 5432, so a native
Postgres already listening there means the container comes up **healthy** — the
healthcheck is `pg_isready`, which reports a server accepting connections and
does not authenticate — while your command reaches the *other* database and fails
with `role "darkroom" does not exist`, which reads like a missing migration.

`darkroom`'s compose stack defaults to `DARKROOM_OBJECT_STORE=memory`, which is
what makes the local path work with no bucket and no credentials. Its
deployment build is the `s3` feature.

### Migrations are a step you run, not something that runs itself

Every service applies its schema separately, in its own language, with its own
tool. None of them migrates on boot — a rolling deploy with two versions live
would race, and a half-applied migration would take the process down with it.

`identity` uses `goose`, which is a command-line tool rather than a module
dependency:

```sh
export DATABASE_URL=postgres://identity:identity@localhost:5432/identity
goose -dir migrations postgres "$DATABASE_URL" status   # what has been applied
goose -dir migrations postgres "$DATABASE_URL" up       # apply everything pending
```

`billing` uses Rails migrations:

```sh
DATABASE_URL=postgres://billing@localhost:5432 bin/rails db:prepare
```

`muse` applies plain SQL:

```sh
psql muse -f migrations/00001_outbox_events.sql
psql muse -f migrations/00002_vault_secrets.sql
```

In production, run `up-by-one` (or the equivalent) as a single ordered job
*before* the new image rolls out, and fail the deploy on a non-zero exit.

**On a `caf dev` stack, run them from inside the compose network.** The
rendered file publishes only the service's own port, so `goose` on the host has
nothing to connect to, and the first request you make before migrating fails with
a bare `500` whose real reason — `relation "users" does not exist` — is only in
the service's logs. [Hosted pilot onboarding](/pilot/#step-5--apply-the-migrations)
has the loop that was run, and why it does not record a goose version.

## Step 6 — deploy to your own infrastructure

<span class="badge caution">Coming soon</span> — `caf deploy` parses its flags
and returns `not implemented in v0`.

```sh
caf deploy identity --dry-run    # caf: caf deploy: not implemented in v0
```

It takes `-env` (default `staging`), `-dry-run`, and `-yes`, and its usage line
is `caf deploy [flags] <service>`. There is no hosted cafaye platform to deploy
to yet, so there is also no remote to authenticate against.

**Today you deploy the same way you deploy any container: build the image from
the repository's own Dockerfile and run it.** Every service ships a
multi-stage, non-root Dockerfile, and they are not interchangeable — each pins
its own base image and runtime.

:::caution[`kit` ships a Kamal configuration; no repository has adopted it]
`kit/templates/kamal/` holds the three files a Kamal deployment is made of —
`deploy.yml.erb` (→ `config/deploy.yml`), `kamal-backup.yml.erb` (→
`config/kamal-backup.yml`) and `drill.sh` (→ `bin/drill`). **Only `billing` has
a `config/deploy.yml` at all**, and it is the stock Rails-generated file rather
than kit's template — its `accessories:` block is commented out.

So `docker build` + `docker run` below is the real path today, and the Kamal
files are the shape to adopt when you want backups. Two things to know before
you do, because both are counter-intuitive:

- **`kamal` is a Ruby gem, so your machine needs Ruby.** Not the service image —
  a service image never needs Ruby, whatever its language — and not the server.
  The `backup` accessory ships its own Ruby inside the container. Only the
  operator's machine carries the requirement, and it comes from Kamal rather than
  from cafaye.
- **`kit`'s deploy tooling is not remote.** `templates/bin/deploy.sh` runs a
  production-*shaped* deployment — health gates, rollback, credential injection —
  against a **local Docker daemon**. Pointed at your own machine it is a local
  production-shaped run, and it does not become a remote deploy by being called
  from a laptop.

[Backup and restore](/runbooks/backup-and-restore/) is where this gap was
measured, and it is the runbook that tells you which of the seven services have
adopted what.
:::

```sh
git clone git@github.com:cafaye/identity.git
cd identity
docker build -t identity .
docker run --rm -p 8080:8080 \
  -e DATABASE_URL='postgres://identity:***@postgres:5432/identity?sslmode=require' \
  -e LOG_LEVEL=info \
  identity
```

The images run as uid 65532 on `gcr.io/distroless/static-debian12:nonroot`, so
there is no shell in the container. That is deliberate, and it means you cannot
`docker exec sh` into a running service to debug it: use the probes and the
logs.

| Service | `docker build` | Runtime port | Base |
| --- | --- | --- | --- |
| `identity` | `docker build -t identity .` | 8080 | `gcr.io/distroless/static-debian12:nonroot` |
| `billing` | `docker build -t billing .` | 80 | `ruby:4.0.1-slim`, entrypoint `/rails/bin/docker-entrypoint` |
| `courier` | `docker build --build-arg SERVICE_NAME=courier -t courier .` | 4000 | `debian:trixie-20260918-slim` |
| `darkroom` | `docker build -f docker/Dockerfile --build-arg --features s3 -t darkroom .` | 8080 | a Rust static binary; **the Dockerfile is under `docker/`, not the root** |
| `muse` | `docker build -t muse .` | 8000 | `python:3.14-slim` |
| `guard` | `docker build -t guard .` | 8080 | `oven/bun:1.3.12-slim` |
| `parlor` | `docker build -t parlor .` | 3000 | `node:22-slim` |

The order that works, and the order that bites:

1. **Migrate first, as a job.** The service never migrates on boot. A schema
   the new image needs must exist before the new image starts.
2. **Roll out.** The probes below decide whether traffic is held back.
3. **Read `/readyz`, not `/healthz`.** Liveness answers whenever the process can
   dispatch. Readiness answers 503 while the service cannot do work. Restarting
   on a readiness failure is how a dependency outage becomes a crash loop.

| Service | Liveness | Readiness |
| --- | --- | --- |
| `identity` | `GET /healthz` → always 200 | `GET /readyz` → 200, or 503 with each probe bounded at 2s |
| `billing` | `GET /healthz` → always 200 | `GET /readyz` → 200, or `503 {"status":"error","checks":{"database":"error"}}` |
| `courier` | `GET /healthz` → always 200, never touches the database | `GET /readyz` → 503 while the database is unreachable |
| `darkroom` | `GET /healthz` → consults nothing | `GET /readyz` → really runs a query |
| `muse` | `GET /healthz` → 200, consults nothing | `GET /readyz` → reports the `db` slot |
| `guard` | `GET /healthz` → always 200 | `GET /readyz` → 200, or 503 if a registered probe is down |
| `parlor` | `GET /healthz` → 200 | `GET /readyz` → `{"status":"ok","deps":"none"}` |

One warning about `courier`: with a database that has gone away underneath a
running pool, `/readyz` takes about **4.4 seconds** to answer 503 — the pool's
queue backpressure, not the query timeout. An orchestrator with a shorter probe
timeout will time out and read `courier` as not ready, which is the same verdict.
Set the probe timeout above 5s or you will restart a service that is answering
correctly.

`guard`'s probes sit on the same port as its API, and it is **not** in the
table above for `/v1/*` because `guard` routes nothing yet: `/v1/me` proves the
auth chain and forwards nothing.
### What is not in this path yet

The broker. `core` specifies a transactional outbox and NATS as the transport,
and `identity`, `billing`, `muse`, `courier` and `darkroom` all write
`outbox_events` correctly, in the same transaction as the domain change — but
**no service starts a publisher loop**, and `identity`'s only `Publisher`
implementation is a deliberate no-op that would mark every event published and
drain the outbox into nowhere. Events land in the table and stay there.

That is not a bug to work around; it is the state of the platform, and it is the
first thing to know if you are waiting for a downstream reaction that never
comes. [Troubleshooting](/troubleshooting/) has the entry, and
[Upgrading](/upgrading/) opens by saying how much of the event surface this
actually affects — it matters if you wrote your own publisher loop, and not at
all if you did not.

**Observability is instrumented and not deployed, and those are two different
sentences.** `core` ships seven telemetry schemas and enforces the contract;
`courier`, `billing`, `identity` and `muse` each wire an OTel SDK and export
traces to whatever `<SERVICE>_OTEL_ENDPOINT` names, defaulting to the collector
that ships with the stack. **No collector is deployed anywhere in a cafaye
environment**, so a service started from its own `docker-compose.yml` is
exporting to a host that is not there.

Getting a collector takes `bin/dev`, which **three of the seven repositories
already carry** (`identity`, `courier`, `billing`) — it fetches kit's whole stack
at the ref in `kit.ref`, brings it up, and prints the URLs. The other four have
no `bin/dev`, and copying it is the fix: `cp <kit>/templates/bin/dev.sh ./bin/dev`
(plus a `kit.ref` pinning a 40-character commit sha, because `bin/dev` refuses a
branch name before it makes any network call).
[Observability](/observability/) has the per-service table and the three states,
and says what the gap costs you.

## What to read next

- [Hosted pilot onboarding](/pilot/) — the same path, aimed at somebody who has
  already decided, with the licence position and every gap stated before you
  commit.
- [Upgrading](/upgrading/) — if you already run a deployment and are moving to
  the current contracts.
- [Architecture](/architecture/) — what each service owns, and why the
  boundaries are where they are.
- [Topology](/architecture/topology/) — the operator's table: ports, probes,
  environment variables, the HTTP surface of each service, and the cross-repo
  drift audit.
- [Contracts](/contracts/) — `cafaye.yml`, the event envelope, OpenAPI. The one
  thing worth understanding before anything else.
- [Observability](/observability/) — the telemetry contract, and the gap between
  it and a running stack.
- [Services](/services/) — one page per service, each stating what is built and
  what is not.
- [Runbooks](/runbooks/) — provisioning, backup and restore, secret rotation,
  a service down, and billing webhooks. Read them before the first incident, not
  during it.
- [Running the gates](/running-the-gates/) — the real gate for every repository,
  including the tiers that do not run by default.
- [Troubleshooting](/troubleshooting/) — keyed by symptom.
