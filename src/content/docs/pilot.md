---
title: Hosted Pilot Onboarding
description: The path from nothing to a running deployment, end to end — what you get, what it costs, what still is not ready, and what we ask back.
---

You have evaluated the platform, you have said yes, and you are sitting in
front of a laptop with a credit card. This page is the whole path from nothing
to something running that you can show your team, in order, with the failure
branch beside every step. It is not a tour of the features.

**Every command on this page was run against `caf` at commit `460acf3` and
`identity` at `master`, `35c2576`, on macOS with Docker 29.4.0.** Output is
quoted where it matters. Where a step could not be run here, the page says so on
the step rather than implying it was verified. The last section lists those.
Both repositories move; the numbers on this page are a dated snapshot and the
ones that matter are the ones you can re-run.

## Read this before anything else

**There is no hosted cafaye.** Not "not yet" — there is no platform of ours for
you to point at. `caf deploy` is a stub that parses its flags and returns `not
implemented in v0`, and there is nothing behind it to authenticate against. What
exists is **public GitHub repositories** and a CLI.

So "hosted pilot" means: *you run it, in your own infrastructure, on your own
cloud account or your own metal, and we help you get it running and keep it
running.* Your Postgres, your bucket, your TLS terminator, your keys. That is the
product as it stands, and it is the thing to decide about before you spend an
afternoon on it — if what you wanted was a vendor-operated SaaS platform, this is
not that yet, and we would rather say so now than in month two.

Read the [what is not ready](#what-is-not-production-ready-yet) section before
you commit. It is the honest list, and it is short.

## What you get, and what it costs

### The services

Seven services, each in its own repository, each versioned on its own. Take the
one you need rather than the whole platform.

| Service | What it owns | Language | The gap you will hit |
| --- | --- | --- | --- |
| [`identity`](https://github.com/cafaye/identity) | Users, sessions, accounts, roles, invitations, OIDC provider, MFA | Go | No password reset, no email verification, no refresh tokens, no admin API |
| [`billing`](https://github.com/cafaye/billing) | Plans, customers, subscriptions, prepaid credit, Stripe in and out | Ruby | No customer portal, no refunds, no usage-events API |
| [`courier`](https://github.com/cafaye/courier) | Transactional email, preferences, **every outbound webhook** | Elixir | **No email provider adapter configured** — nothing is delivered until you set one |
| [`darkroom`](https://github.com/cafaye/darkroom) | Signed uploads, tenant-scoped assets, variants, S3 and R2 | Rust | No transcoding, no CDN, no malware scanning |
| [`muse`](https://github.com/cafaye/muse) | LLM routing, encrypted credentials vault, token metering | Python | **Auth is a stub** — the token is not verified |
| [`guard`](https://github.com/cafaye/guard) | The public edge: JWT verification, API keys, rate limits | TypeScript | **Proxies nothing.** It serves `/v1/me` and `/auth/*` and forwards no request onward. Sessions are per-process, so one replica |
| [`parlor`](https://github.com/cafaye/parlor) | Next.js app shell: signup, login, accounts, billing screens | Next.js | No admin surface, no e2e suite, and its `cafaye.yml` does not validate |

Each has a page here that states what is built and what is not in its own words:
[Services](/services/). Read the status line before you rely on the row above —
these rows are a summary, the service pages are the claim.

### The licence — read this one

**We have not finished licensing the platform, and the state is not uniform.**

Checked across all thirteen repositories on 2026-09-30:

| Repository | What it declares |
| --- | --- |
| `cafaye-rb` | **`LICENSE.txt`, MIT**, "Copyright (c) 2026 cafaye" — the only repository with a licence file |
| `darkroom`, `pantry` | `license = "MIT"` in `Cargo.toml`. No licence file. |
| `guard`, `docs` | `"license": "MIT"` in `package.json`. No licence file. |
| **`muse`** | **`license = { text = "AGPL-3.0-only" }` in `pyproject.toml`, and a README that says the same** |
| `identity`, `billing`, `courier`, `parlor`, `core`, `caf`, `kit` | **nothing.** No licence file, no field in any manifest. |

Three consequences, and the third is the one that matters:

1. **Ten of thirteen repositories state no licence at all.** GitHub's default
   for a public repository with no licence is "all rights reserved". We do not
   think that is the intent and it is not what we are offering.
2. **`muse` is AGPL-3.0-only**, not MIT. AGPL has network-use copyleft: modify
   `muse`, run it as a service others reach over a network, and section 13 asks
   you to offer them your modified source. That may be exactly right for an LLM
   gateway. It is also a different licence from the one the rest of the platform
   is heading towards, and it is the only copyleft in the fleet.
3. **So: do not self-host this on a commercial assumption without a written
   answer from us.** Ask, and get the grant in writing, before you build on it.
   We would rather have that conversation on day one than discover an
   `AGPL-3.0` `pyproject.toml` in month two.

:::caution[What "open source" means on the org page]
[github.com/cafaye](https://github.com/cafaye) is a public organization and the
repositories are public. Public is not the same as licensed, and this section
is the reason: the code is readable, and the grant is not written down.
:::

### What it costs to run

**We have not published a sizing guide, and this page is not going to invent
one.** Here is what the code actually asserts, and it is all of it:

- **`caf doctor` holds a floor of 4 GiB of memory and 4 CPUs** for a local stack
  — a database, a cache and a service at once. That is a floor in
  `caf/internal/cli/doctor_env.go`, not a recommendation, and it is the only
  number in the fleet about how much machine you need.
- **Every service is one stateless container.** Multi-stage, non-root, no volume
  mounted. Replacing or restarting one loses nothing.
- **Five Postgres databases**, one per service that owns state: `identity`,
  `billing`, `courier`, `darkroom`, `muse`. `guard` and `parlor` own none.
  Postgres is the only thing a backup has to cover, except the bucket below.
- **Redis** if you set `REDIS_URL` on `guard`. Rate-limit counters live there;
  the browser session store does not, and that is a per-process `Map`.
- **One object-storage bucket you choose**, for `darkroom` — S3 or Cloudflare
  R2, one implementation, two configurations. It is not covered by `pg_dump`.
- **One `identity` container brought up this way is three containers.** Verified:
  `caf dev` on `identity` renders `identity` plus `postgres:16-alpine` plus
  `redis:7-alpine`.

There is no managed tier, no per-seat pricing, and no hosted control panel to
subscribe to. What a pilot pays for is engineering time, not a licence fee.

### What leaves your infrastructure

By default, **nothing**. No telemetry is exported unless you configure it, no
service dials a cafaye-operated endpoint, and there is no licence check, no
update check, and no analytics in any of them. (`docs.cafaye.com` itself has no
analytics and no third-party scripts either — that is a decision recorded in
this repository, not an oversight.)

Four things will leave, and only if you turn them on:

| Egress | Who initiates it | Your bucket, your account |
| --- | --- | --- |
| Presigned upload and variant writes | `darkroom`, to a bucket you name | yours |
| LLM provider requests | `muse`, to providers whose keys you put in the vault | your provider contract |
| Stripe API calls and signed webhooks | `billing`, when you configure Stripe keys | your Stripe account |
| Email delivery | `courier`, **once you configure a provider adapter** — none is set by default | your provider |

## Before you start: check the machine

This is a check you can run, not a sentence to interpret.

```sh
go install github.com/cafaye/caf/cmd/caf@latest
caf doctor
```

There is no tagged release, so `@latest` resolves to a pseudo-version built from
`master`. That works today, and it is the only install path: there is no
Homebrew tap and no `caf install`.

`caf doctor` prints **two tables and always exits 0** — it is a report about a
machine, not a gate, so a `missing` row is something you read rather than a CI
failure.

The first table is the toolchain. Ten rows, in this order, each resolved on
`PATH` and **never executed**:

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

**That list is not an opinion on this page.** It is the `tools` table in
`caf/internal/cli/doctor.go`, one entry per row, and the order above is the
table's order. `python` resolves `python3` then `python`; `rust` resolves
`rustc` then `cargo`. If a service you want adds a language, that table is where
the requirement comes from.

**You do not need all ten.** You need the languages of the services you intend
to run, plus `git` and `docker`. `identity` alone needs `go`; `parlor` needs
`bun`.

The second table is the one the first cannot answer — *can this machine run this
project*:

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

Read it before step 4, because three of its rows are invisible from the first
table:

- **`runtime running` asks the Docker *server*, not the binary.** A stopped
  Docker Desktop is still on `PATH`, so the tool table says `ok` while nothing
  can start. A failure here reads `unreachable` and says to start the runtime.
- **`memory` and `cpu` are the 4 GiB / 4 floor.** A machine reports every
  toolchain it needs and still cannot run a stack.
- **`port 8080 free`.** If something else holds it, `caf dev -port` publishes
  the project service somewhere else — but the databases and caches do not move,
  so fixing a collision on 5432 is a different problem.

:::caution[Running it with no project at all]
`caf doctor` in a directory with no `cafaye.yml` prints the tool table and then
one line:

```
project .: no manifest: no cafaye.yml in .; a project declares its service in one
(run "caf init" to create it, or pass the project directory as the argument)
```

That is not a failure. It is the second table saying it has nothing to plan. Run
it again from step 2 and it will answer the real question.
:::

## The path

### Step 1 — install the CLI

```sh
go install github.com/cafaye/caf/cmd/caf@latest
caf version
```

```
caf 0.0.0-dev (commit unknown)
```

That version string is not a mistake. The semver and commit are injected at link
time by the release pipeline; a `go install` from an untagged commit has neither.

**If that version line says anything else**, you have a tagged release, which is
better — carry on.

**If it says `caf: command not found`**, the install worked and your `PATH` does
not. `go install` writes to `$(go env GOBIN)`, which is `$GOPATH/bin` for a
system Go and **somewhere else entirely under a version manager** — on the
machine this page was written on, `GOBIN` is a mise directory and `$GOPATH/bin`
is not on `PATH` at all:

```sh
go env GOBIN
export PATH="$(go env GOBIN):$PATH"
```

Do not assume `$HOME/go/bin`. On that machine it exists, it is not on `PATH`,
and it holds a `cafaye-cli` from months earlier that is not this program.

### Step 2 — get the source

```sh
git clone git@github.com:cafaye/identity.git
cd identity
```

**Why `identity` first.** It declares no dependency on another cafaye service,
which means the whole stack is one service plus its database plus a cache.
`darkroom` is the other one in that position, and `courier` and `billing` declare
empty lists; `muse` and `guard` reach `identity`. Get this one working, then add
the others.

**If the clone fails on SSH**, you do not have a key registered on GitHub. Use
HTTPS for a read-only clone if you have to — `git clone
https://github.com/cafaye/identity.git` — but keep SSH for anything you push.
PLAN.md §1 makes SSH the rule for repositories cafaye owns.

If you are adding **your own** service rather than running ours, `caf new` and
`caf init` are stubs — they parse their flags and return `not implemented in
v0` — so write the manifest by hand. The minimum that validates is this, and it
was linted:

```yaml
name: pilot-app
description: A pilot's own application.
language: typescript
core: ^0.2.0

dependencies:
  - name: identity
    version: ^0.1.0
    required: false

repository:
  url: git@github.com:acme/pilot-app.git
  defaultBranch: master
  visibility: private

owner:
  team: platform
  contact: platform@acme.example
```

`language` must be one of `go`, `ruby`, `elixir`, `python`, `typescript`,
`rust`, `spec` — core's schema has no value for a repository with no server in
it. Put your real coordinates in `repository` and `owner`; the ones above are
placeholders.

### Step 3 — prove the manifest

```sh
caf contract lint ./cafaye.yml
```

```
OK ./cafaye.yml
```

One line per manifest and nothing else, so it is greppable and diffable. **Exit 1
if any manifest is invalid, and also if the path holds no manifest at all** — a
tree that validated nothing is not a pass.

**If it says `INVALID … is missing required fields ["name", "language", "core",
"repository", "owner"]`**, you are looking at the shape `parlor` still has. Copy
the keys from step 2 rather than trying to work out which one is missing.

Point it at a directory and it walks the tree, skipping `.git`, `node_modules`,
`deps`, `_build` and `target`. On a whole checkout of the platform it prints one
line per **manifest**, not per repository — `pantry` alone contributes ten,
because its registry ships a copy of every service's `cafaye.yml`. On the
workspace this page was written against that was **31 manifests, 26 `OK`, 5
`INVALID`, exit 1**, and only one of the five is a defect: `parlor`'s. Three of
the other four are `core`'s own negative test fixtures, which exist to be
rejected. [Topology](/architecture/topology/#cross-repo-drift-audit) has the
table — and re-run it, because that number moves with every packet and the
answer underneath it does not:

```sh
caf contract lint /path/to/cafaye
```

### Step 4 — bring the stack up

```sh
caf dev --dry-run .     # render and print; start nothing
caf dev .
```

`--dry-run` first is not optional politeness: it prints the rendered compose file
in full, so you can see what `caf dev` decided before it decides it for you. On
`identity` it renders three services — `identity` built from the repository's
own `Dockerfile`, plus `postgres:16-alpine` and `redis:7-alpine` — and writes
`caf.dev.compose.yaml` into the project.

Then bring it up. This builds the image, so the first run takes minutes:

```
starting 3 services in identity-dev

service   status   origin          notes
postgres  healthy  infrastructure  Up 10 seconds (healthy)
redis     healthy  infrastructure  Up 10 seconds (healthy)
identity  running  project         Up Less than a second

identity is up on http://localhost:8080
```

`caf dev` leaves the stack running when it exits. To stop it:

```sh
docker compose -p identity-dev down
```

which takes the containers and the network down and **leaves the volumes**, so
your data survives. Add `-v` when you want the database gone as well.

**Four ways this step fails, and what each one means:**

- **`nothing to run: … has no docker/Dockerfile and the local registry names no
  image for it`.** You are in a directory without a `Dockerfile`. `caf dev`
  builds your service from the project directory; there is no registry entry for
  a repository it has never seen.
- **`skipped legacy: optional dependency, and the local registry does not know
  how to run it`.** Your manifest declares a dependency on another cafaye
  service. `caf dev` resolves dependencies through a catalog and the default
  catalog is empty — `pantry` serves the official one over HTTP, but `caf dev
  -registry` reads a **local JSON file**, and no catalog file is published yet.
  Run each service in its own directory until one is.
- **A container never reaches `healthy`.** Read `docker compose -p identity-dev
  logs`. `caf dev` waits three minutes by default (`-wait`) before it reports
  what did not come up, which is generous because a first run is mostly a build.
- **`port 8080 in use`.** `caf doctor` predicts this one. `caf dev -port 8081`.

### Step 5 — apply the migrations

**`caf dev` does not run migrations, and it does not publish the database on a
host port.** Both of those matter, and together they make this the step a stuck
reader stops at.

The stack is up and `GET /readyz` answers `{"status":"ok","deps":"postgres"}`,
which is real — the pool is open and the query works. The schema is simply
empty. The first request fails like this:

```
HTTP 500
{"type":"https://errors.cafaye.com/internal","title":"Internal server error",
 "status":500,"detail":"the request could not be completed. Quote the trace id
 when reporting this.","instance":"/v1/users","code":"internal",
 "trace_id":"7d45460a-1d11-4628-a658-7da100eee6f3"}
```

A bare 500 with no reason is the tell. The reason is in the service's logs, and
it names the actual problem:

```
level=ERROR msg="request failed" error="inserting a user: ERROR: relation
\"users\" does not exist (SQLSTATE 42P01)" trace_id=7d45460a-… method=POST
path=/v1/users
```

No service in this platform migrates on boot, and that is deliberate — a rolling
deploy with two versions live would race, and a half-applied migration would
take the process down with it. It is a deploy job, which locally means you run
it.

Because `caf dev` keeps Postgres on the compose network, run the migrations from
inside it:

```sh
for f in migrations/0*.sql; do
  printf '%s ' "$f"
  awk '/^-- \+goose Up/{p=1;next} /^-- \+goose Down/{p=0} p' "$f" \
    | docker compose -p identity-dev exec -T postgres \
        psql -q -U identity -d identity -v ON_ERROR_STOP=1 \
    && echo ok || break
done
```

```
migrations/00001_init.sql ok
migrations/00002_users.sql ok
migrations/00003_sessions.sql ok
migrations/00004_outbox_events.sql ok
migrations/00005_accounts.sql ok
migrations/00006_account_users.sql ok
migrations/00007_account_invitations.sql ok
migrations/00008_connected_accounts.sql ok
migrations/00009_oidc_clients.sql ok
migrations/00010_mfa.sql ok
```

`awk` extracts each file's `Up` section so the `Down` sections do not run behind
it. `ON_ERROR_STOP=1` is what stops a failure from scrolling past as a success.

:::caution[This does not record a version]
That loop applies SQL. It does not write goose's `goose_db_version` table, so a
later `goose … status` will report every migration as pending and a later `goose
… up` will try to apply them all again and fail. For a local stack that is
harmless — drop the volume with `docker compose -p identity-dev down -v` and
start over. **In production, run `goose` itself**; the recipe is in that
repository's `migrations/README.md`.
:::

### Step 6 — the first request

```sh
curl -s localhost:8080/healthz
curl -s localhost:8080/readyz
```

```
{"status":"ok"}
{"status":"ok","deps":"postgres"}
```

`deps: "postgres"` is the one that matters. `deps: "none"` means `DATABASE_URL`
is unset — no pool, no readiness dependency, and no `/v1` routes at all, which
is a clean `404` rather than an error.

Now create somebody and sign them in:

```sh
curl -s -X POST localhost:8080/v1/users \
  -H 'Content-Type: application/json' \
  -d '{"email":"pilot@acme.example","password":"correct-horse-battery-staple"}'
```

```
{"id":"5e1efb8c-240c-4cb1-9b14-1677238a04c9","email":"pilot@acme.example"}
```

```sh
curl -s -X POST localhost:8080/v1/session \
  -H 'Content-Type: application/json' \
  -d '{"email":"pilot@acme.example","password":"correct-horse-battery-staple"}'
```

```
{"token":"REDACTED","expires_at":"2026-10-30T12:23:14.540471907Z"}
```

The token is a **43-character** base64url string — 32 random bytes, unpadded —
valid for thirty days, redacted here because it was a real one from a throwaway
database that has since been deleted. `POST /v1/session` also sets a
`__Host-session` cookie to the same value, `HttpOnly; Secure; SameSite=Lax`; for
a script, the bearer header is what you want.

Use it:

```sh
export TOKEN=$(curl -s -X POST localhost:8080/v1/session \
  -H 'Content-Type: application/json' \
  -d '{"email":"pilot@acme.example","password":"correct-horse-battery-staple"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')

curl -s localhost:8080/v1/me -H "Authorization: Bearer $TOKEN"
```

```
{"id":"5e1efb8c-240c-4cb1-9b14-1677238a04c9","email":"pilot@acme.example"}
```

**That is the first ten minutes.** A service built from its own Dockerfile, a
database it migrated itself, and an authenticated round trip.

**What you will get when you check the database:**

```
           type           | unpublished | attempts
--------------------------+-------------+----------
 identity.account.created | t           |        0
 identity.user.created    | t           |        0
```

Two rows for two actions. **`unpublished: t` is expected and is not a fault.**
See the next section.

### Step 7 — check the two things this stack is not giving you

Both of these surprise people, and both are one line of configuration rather
than a defect to file.

**The OIDC provider is not mounted.** `GET /.well-known/jwks.json` returns
`404` on this stack, and so does `/.well-known/openid-configuration`. Not
because OIDC is broken — it is built and tested — but because `Config.OIDCEnabled()`
requires all three of `OIDC_ISSUER`, `OIDC_SIGNING_KEY` and `OIDC_SIGNING_KEY_ID`
to be set, and `caf dev` sets none of them. A process with no signing key serves
its `/v1` surface and its probes and nothing else, deliberately, because there is
no key to sign with and no document to publish.

**Consequence for a pilot:** `guard` verifies bearer tokens against identity's
JWKS. With no JWKS, `guard` has nothing to verify against. Until you set those
three variables, call `identity`'s `/v1` directly, which is what steps 5 and 6
do.

**MFA is not mounted either**, and it says so twice on startup — first the
reason, then the consequence:

```
level=WARN msg="MFA_ENCRYPTION_KEY is not set"
level=WARN msg="MFA_ENCRYPTION_KEY is not configured; the MFA management routes
are not mounted and this process cannot verify a second factor for anybody"
```

`GET /v1/mfa` answers `404`, which is the same fact from the outside.

**MFA is built** — TOTP enrollment, the login challenge, recovery codes, the
whole surface, with its own OpenAPI document. `MFA_ENCRYPTION_KEY` is base64url,
**exactly 32 bytes**, seals the TOTP secret at rest, and is never generated at
boot. Unset means the management routes are absent; a value of the wrong length
is a startup failure.

**To turn it on locally, use the repository's own Compose stack rather than
`caf dev`**, because `caf dev` has no flag to add environment variables and
rewrites its rendered file on every run:

```sh
cd identity
export MFA_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '=\n' | tr '+/' '-_')
docker compose up -d
```

:::caution[That command is a shape, not a verified recipe]
The two `tr` calls turn 32 bytes of base64 into the 43-character unpadded
base64url string the service reads — checked, it decodes back to exactly 32
bytes, and `identity` refuses to start if it does not. The `tr -d '=\n'` matters:
base64 padding and the trailing newline are both length, and a value one
character too long fails at boot rather than at enrollment.
The enrollment-and-confirm walkthrough is in that repository's README and was
**not** re-run for this page — see [what this page does not
verify](#what-this-page-does-not-verify).
:::

### Step 8 — provision a tenant, then put it somewhere that is not your laptop

You have a user. You do not have a customer.

Registration creates a **personal account** for that user in the same
transaction — one nobody chose, named after them. Your tenant is the *second*
account, a deliberate one with a slug somebody can put in a hostname. Both
existing is normal, and it surprises people.

The full procedure, every response quoted from a live session, is
[Tenant provisioning](/runbooks/tenant-provisioning/). It is seven `curl`
calls and ends with a verification step, because applying changes is not
evidence that they worked.

**Then read [Backup and restore](/runbooks/backup-and-restore/) before you have
anything in the database you care about.** It is the runbook for the moment you
find out you needed it last week.

For a real deployment, [Getting started](/getting-started/) has the per-service
build and run steps and the container table, and [Topology](/architecture/topology/)
has every port, probe and environment variable in one place.

## Where your data goes

**Database-per-service.** Each service that owns state has its own Postgres
database, in your infrastructure, and no service reads another's. There is no
shared database, no shared schema, and no cross-service query. `identity`'s
customers and `billing`'s customers are different rows in different databases
that happen to share a uuid.

That is the whole tenancy story for the platform's data, and it is why a service
can be replaced, upgraded or scaled without coordinating with the other six.

**The outbox, and why nothing arrives anywhere.** Every service that records
something worth telling another service about writes a row to its own
`outbox_events` table **in the same transaction as the domain change**. That is
the rule, and it is the reason a service cannot commit a change and then fail to
record that it happened.

**No service starts a publisher loop.** `identity`'s only `Publisher`
implementation is a deliberate no-op; starting it would mark every event
published and drain the outbox into nowhere. So `published_at` stays null and
`attempts` stays 0, as in step 6, and **a cross-service reaction does not
happen.** An event in this platform today is a row, not a notification.

What this means for a pilot, plainly: if you are waiting for `billing` to react
to a new signup, it will not, and it is not a bug in your deployment. Read the
outbox yourself, or build the consumer loop that drains it. Both are legitimate;
what is not legitimate is waiting.

**`courier`'s outbound webhooks are the exception, and they are real.** They are
HTTP requests `courier` makes itself, with the Standard Webhooks signature
headers, a retry budget and a circuit breaker — not events on a bus.

**"Self-hosted" means what it says.** Your Postgres, your bucket, your keys,
your TLS terminator. Your backups, on your schedule. There is no cafaye-operated
component in the stack, no account, and no telemetry leaving it unless you
configure it. If you want us to run it for you, that is consulting work we have
not productised — ask, and we will scope it honestly.

## What is not production-ready yet

Every line here is a fact about the current code, with where you can check it.
This is the section to read before you commit, and to re-read in month two —
because it will get shorter and this page will be updated when it does.

| Not ready | What it means for you | Where to check |
| --- | --- | --- |
| **No broker. Nothing publishes events.** | Events accumulate unpublished. No cross-service reaction happens. | `outbox_events` in any service; the publisher loop in `core/docs/event-outbox.md` |
| **`guard` proxies nothing.** | It authenticates and forwards no request onward. Call services directly, or accept that `guard` is an auth decorator today. | `guard`'s route table; `/v1/me` |
| **`guard` sessions are per process.** | A browser session dies with the replica it signed in on, and is lost on restart. **Run one replica.** | the `SessionStore` in `guard` |
| **`muse` does not verify the token it is given.** | Do not put `muse` behind anything you care about. | `muse`'s auth stub |
| **`caf deploy`, `caf gen`, `caf init`, `caf new`, `caf mcp` are stubs.** | Five of the ten commands `caf help` lists parse their flags and return `not implemented in v0`. You deploy by building each repository's Dockerfile. | `caf/internal/cli/*.go`; the table in [Getting started](/getting-started/) |
| **Telemetry is instrumented; no collector is deployed.** `courier`, `billing`, `identity` and `muse` each export traces, and nothing in a cafaye environment receives them. `kit` ships the stack and `bin/dev` runs it, so a pilot gets traces rather than a promise. | You will not have a fleet-wide trace view until you run the stack, and you should budget for wiring `<SERVICE>_OTEL_ENDPOINT` at whatever backend you already pay for. `muse` is not on core's `error.type` vocabulary, so do not group a cross-service error panel on that attribute. | [Observability](/observability/) |
| **No password reset, no email verification.** | A user who forgets their password has no path back in. **Plan a support channel for this.** | `identity`'s README, "Not built yet" |
| **`identity` OIDC has no refresh tokens.** | Access tokens live fifteen minutes and cannot be renewed. | the discovery document, where the absent features are absent rather than stubbed |
| **No vault key rotation.** | `MUSE_VAULT_KEY` cannot be rotated in place. | `key_version` is always 1 |
| **`parlor` is not a finished template,** and its manifest does not validate. | Do not clone it expecting a product shell. | the [drift audit](/architecture/topology/#cross-repo-drift-audit) |
| **A green badge may have skipped its hard half.** `kit`'s reusable workflow is callable and eight repositories now call it, but in most of the fleet the interesting tests are a second tier that does not run by default — so "the gate is green" often means somebody ran the suite by hand, that day. The exception is `identity`, whose CI refuses to skip its own database tier. | Check what ran before you check the colour. | [Running the gates](/running-the-gates/) |
| **The licensing is unfinished.** See the section above. | Get a written answer before you build on it commercially. | the table above |

One more that decides whether you can put anything in front of a customer:
**`docs` is the only cafaye repository with no CI workflow at all.** The other
twelve each have a `.github/workflows/ci.yml` on `master`. So a green badge
somewhere in the fleet may still have skipped its hard half — and there is no
badge to read at all on a `docs` commit, which is worth knowing when you ask us
whether something is tested.

Two more that are not gaps but will still surprise you:

- **Nine of the ten event types `identity` writes have no payload schema in
  core, and three of the nine have no catalog row either** — the two
  `oidc_client` types its manifest advertises, plus `identity.member.accepted`,
  which core spells `identity.member.joined`. So exactly one of the ten,
  `identity.user.created`, has both a published name and a published payload;
  six more have a name core published and a payload core never described. If you
  build a consumer on an `identity` event, you are most likely building on a
  payload that does not exist yet. [Upgrading](/upgrading/) has the detail.
- **`billing`'s subscription and plan event payloads do not match core's
  schemas.** `billing` emits its own ids where core's schemas describe the
  payment processor's, and its own contract test says so out loud. Prefer
  `GET /v1/subscriptions/{id}` over the event payload as your source of truth.

## The design-partner flow

### What we ask

Small, specific, and things only a design partner can give:

1. **A real workload on the platform** — your users, your traffic, your data
   shapes. A synthetic benchmark tells us nothing about where the seams hurt.
2. **The first breakage.** The first time something failed in a way you had to
   work around, tell us within a week. That report is the most valuable thing
   this arrangement produces, and it is worthless in month six.
3. **Two hours, twice, for the calls.** One after you are running, one after
   you have hit something. We bring the agenda.
4. **A public write-up, if you are willing.** Not required. Anonymised if you
   prefer, and we will never name you without asking.

What we do **not** ask: a case study you did not agree to, access to your
customers' data, or a reference call you have not prepared for.

### What you get that a public user does not

- **A named human, and a response window.** Not a queue. Agreed in writing
  before the pilot starts.
- **Direct changes, not a backlog ticket.** If something in this platform is
  wrong, you say so and it gets fixed in that repository, with the commit.
- **A seat at the design decisions that affect you** — the tenancy model, the
  event grammar, what the platform refuses to build — while they are still
  open.
- **Your feature requests weighed against a real install**, which is worth more
  than a feature request from somebody who has never run the thing.

### How to reach a human

What exists today, honestly:

- **The repositories.** <https://github.com/cafaye> — every service, its issues,
  and its history. This is the channel we actually watch.
- **A per-service contact address**, declared in each repository's `cafaye.yml`
  under `owner.contact`: `identity@cafaye.com`, `billing@cafaye.com`,
  `courier@cafaye.com`, `darkroom@cafaye.com`, `guard@cafaye.com`,
  `muse@cafaye.com`, `pantry@cafaye.com`, `caf@cafaye.com`, `core@cafaye.com`,
  `cafaye@cafaye.com`, `docs@cafaye.com`. Two repositories declare none —
  `kit` and `parlor` — so there is no address to write to for those two.
- **This site.** Every command on it was run, and every gap on it was measured.

What does **not** exist yet, and we would rather say so than have you discover
it: **a support address, a status page, an uptime record, and an SLA.** None of
those is published anywhere on the org today. They come with the pilot
agreement, in writing, before you start.

## What this page does not verify

Stated here rather than left for you to guess:

- **Nothing on macOS with Docker Desktop was run on Linux.** No step was run on
  a Kubernetes cluster, on ARM outside this machine, or against a managed
  Postgres. Steps 1–6 are one machine, one platform, one day.
- **`caf dev` bringing up a project that depends on another cafaye service was
  not run**, because no published catalog file exists for `-registry` to read.
  Step 4 states the error message the code produces for it; the message was read
  from `internal/dev/registry.go`, not captured from a run.
- **The MFA enrollment walkthrough was not re-run.** The route table, the
  OpenAPI document and the startup warning above are all real and were read; the
  `openssl` one-liner in step 7 is a shape, not a verified recipe, and its
  32-byte requirement is the thing to get right.
- **A production deployment was not performed.** No `docker build` for each of
  the seven services, no rollout, no restore from a real backup.
- **Only `identity` was actually run.** The other six services' rows are read out
  of their repositories, not exercised. `caf dev --dry-run` was run against
  `darkroom` as a second data point and rendered three services correctly — its
  Dockerfile path comes from its manifest, not from the project root, so `caf dev`
  finds it — but nothing was brought up.
- **Sizing was not measured.** Nothing on this page says how much memory or CPU a
  production install wants, because nobody in the fleet has published that and
  this page did not go and find out.
- **`muse` was not started.** Its AGPL declaration was read out of
  `pyproject.toml` and its README; its behaviour was not exercised.
- **Billing was not run against Stripe.** The lifecycle claims come from that
  repository's README and its tests, not from a live processor.
- **The tenant-provisioning runbook was not re-run for this page.** It was run
  live when it was written and every response in it is quoted from that session;
  re-running it was out of scope here, and it is linked rather than repeated.

If a step here is wrong, that is a bug in this page and it is worth an issue on
[the docs repository](https://github.com/cafaye/docs). If a step is missing,
that is worse, and the same applies.

## See also

- [Getting started](/getting-started/) — the longer version of the path, with
  every service's build and container table.
- [Tenant provisioning](/runbooks/tenant-provisioning/) — the next thing you
  need, quoted from a live session.
- [Topology](/architecture/topology/) — every port, probe, environment variable
  and the cross-repo drift audit.
- [Upgrading](/upgrading/) — if you are already running something.
- [Services](/services/) — what each one is, in its own words.
- [Running the gates](/running-the-gates/) — how to tell a real green from a
  skipped one.
