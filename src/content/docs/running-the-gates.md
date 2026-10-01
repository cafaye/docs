---
title: Running the Gates
description: The exact command for every cafaye repository, and the second tiers that do not run by default.
---

**A gate that skips proves nothing, and a runbook that tells you to run the gate
without naming the environment it needs is instructing you to verify nothing.**
Most of that is on this page.

Every command below was read out of the repository it belongs to, from its
`bin/prime`, its `mise.toml`, or its CI workflow. Where a repository and this
page disagree, the repository is right.

## First, the thing that is not true

:::caution[CI is not fleet-wide yet]
**`kit`'s reusable workflow is callable now.** It used to sit at
`workflows/ci.reusable.yml`, where GitHub cannot resolve it, and this page said
for several packets that the reusable CI path did not exist. It has moved to
**`.github/workflows/ci.reusable.yml`**, which is the path GitHub requires, and
eight repositories now call it as
`uses: cafaye/kit/.github/workflows/ci.reusable.yml@master`: `caf`, `core`,
`courier`, `darkroom`, `guard`, `identity`, `muse` and `parlor`.

What exists on `master` today, counted with `git ls-files .github/workflows`:

| Has a CI workflow | Does not |
| --- | --- |
| `billing`, `caf`, `cafaye-rb`, `core`, `courier`, `darkroom`, `docs`, `guard`, `identity`, `kit`, `muse`, `pantry`, `parlor` | — |

`docs` was on the right until **docs-05**, which added
`.github/workflows/ci.yml` (`gate`, `contracts`, `pins`) and
`.github/workflows/external-links.yml` (the network tier). Until then "the gate
is green" for this repository really did mean *a person ran the suite by hand,
that day, on that machine*, and this page used to say so.

`cafaye-py` is on neither side.
That gap predates docs-05 and this repository's suite cannot reach it, so this
page does not claim anything about it: a row here is only correct if it was read
out of the repository it names.

**One repository has closed its own tier, and it is worth naming because it is
the shape the rest of the fleet needs.** `identity` has no longer had a workflow
for two packets; it now calls the reusable workflow *and* runs a second `gate`
job that starts Postgres, runs `goose up` as its own step, and asserts a floor
of 1254 passing tests of which 1166 must be behind `TEST_DATABASE_URL`, plus
**zero** `--- SKIP:` lines, 23 named security tests that have to appear in the
log by name, a `git diff --exit-code` on `go.mod`/`go.sum`, and a coverage floor.
That is what "the interesting tier cannot silently skip" looks like when a
repository decides to mean it.

**The durable warning is not the count, it is the skipping.** A badge is only
worth what it ran, and the tiers below are the part that silently does not run
by default. `identity` is now the exception, and it is one repository — a
workflow file existing does not make the rest of the fleet honest.
:::

## The gate per repository

| Repository | Command | Toolchain |
| --- | --- | --- |
| `core` | `bin/prime` | `mise install` — builds `tests/.venv` on first run |
| `caf` | `bin/prime` && `go vet ./...` && `gofmt -l .` | `gofmt -l .` **must print nothing** |
| `identity` | `bin/prime` && `go vet ./...` && `gofmt -l .` && `go test -race ./...` | `mise install` — **needs Postgres; `bin/dev` brings it up on 15500** |
| `billing` | `bin/prime` | `mise install` — `bundle install`, `db:prepare`, rubocop, `rails test` |
| `courier` | `bin/prime` && `mix precommit` | `mise install` — **needs Postgres; `bin/dev` brings it up on 15500** |
| `darkroom` | `./bin/prime` and `./bin/prime --db` | `mise install` — the second tier needs `TEST_DATABASE_URL` |
| `muse` | `bin/prime` | `mise install` — `uv sync --locked`, ruff, pytest |
| `guard` | `bin/prime` | `bun` — `bun install && bun test` |
| `parlor` | `bin/prime` | `npm ci && npm test` (vitest) |
| `pantry` | `./bin/prime` | `cargo` — **the drift tests skip without a workspace** |
| `cafaye-rb` | `bin/prime` | `mise install` — `rake db:prepare`, rubocop, bundler-audit, `rake test` |
| `kit` | `bash tests/validate.sh` | **needs a virtualenv** — see below |
| `docs` | `./bin/prime` and `./bin/prime --contracts` | `mise install` — the second needs a readable `core` and a `caf` binary, and **fails** rather than skipping without them |

---

## The gated tiers — the part that matters

These are the suites whose **second tier does not run by default**. Each one is
green on a bare machine while proving less than it appears to, and each has an
exact command below.

### `identity` — needs a database **and migrations applied**

`go test ./...` is green with no Postgres and no Docker at all: the integration
tests skip themselves unless `TEST_DATABASE_URL` is set. **Migrations are a
deploy step, not a test step** — and here they are a hard prerequisite, not a
formality:

```sh
bin/dev                              # fetch kit's stack at kit.ref, up --wait, migrate
export DATABASE_URL="postgres://identity:identity@localhost:15500/identity?sslmode=disable"
goose -dir migrations postgres "$DATABASE_URL" up        # <- without this, see below
TEST_DATABASE_URL="$DATABASE_URL" go test ./...
```

**`docker compose up -d postgres` does not work in `identity`.** Its
`docker-compose.yml` is an override with no `image:` on `postgres`, because kit's
stack ships that container; run alone it fails with *"service \"postgres\" has
neither an image nor a build context specified"*. `identity` carries `bin/dev`,
which fetches kit's stack and merges it.

**Skipping `goose up` gives you `relation "public.oidc_clients" does not
exist`**, not a skip and not a clean failure. The OIDC tables were never created
by a migration run, so the tests that need a real server find nothing to talk
to. This is the single most confusing failure in the fleet, because the error
names a relation rather than the missing step.

The exact DSN matters, and **the port is not 5432**: kit's stack publishes its
Postgres on `${KIT_POSTGRES_PORT:-15500}`, and `identity`'s own file publishes
none. A local Postgres install already listening on 5432 means a host-side DSN
pointed there silently reaches the *other* server and fails with
`role "identity" does not exist`, which reads like a missing migration.

Two things this page used to say are no longer true. **`docker compose up -d
postgres` is a command that fails** here, because `identity`'s compose file is an
**override** on `kit`'s stack and carries no `image:` on `postgres`. And the stack
`bin/dev` brings up publishes Postgres on **15500**, because that is `kit`'s port
block. Read it out of the rendered config rather than guessing:

```sh
bin/dev stack          # prints the merged compose file; find the postgres ports
```

`bin/dev` also runs `bin/migrate` for you, so the `goose up` line above is for a
host-side loop or a fresh database rather than the ordinary path. And see [Getting
started](/getting-started/#step-5--run-a-service-locally) for the failure
`bin/dev` currently ends on for this repository.

**This is the one tier in the fleet that CI now refuses to let skip.** Every
command above is what `identity`'s own `gate` job runs, and it asserts the
result: a pass-count floor, zero `--- SKIP:` lines, and 23 security tests that
have to appear in the log by name. So a green `identity` badge is worth more
than the others on this page — and only because that repository decided to make
it worth more.

### `darkroom` — three tiers, two of them non-default

```sh
./bin/prime          # fmt, build, clippy, test — no database needed
./bin/prime --db     # + the #[ignore]d database tests, against TEST_DATABASE_URL
```

`cargo test` alone is green on a bare machine because the database tests are
`#[ignore]`d. There is a **third** tier inside `bin/prime` that is easy to miss:
`cargo test --features s3`, because `cargo test` **does not compile the `s3`
feature at all** — without it the R2 configuration rules, the presigned-URL table
and the startup refusals are decoration in nobody's gate. `--db` runs the ignored
suites both with and without the feature, because the deployment build is a
different build of the library.

```sh
TEST_DATABASE_URL="postgres://darkroom:darkroom@localhost:5432/darkroom_test?sslmode=disable" \
  ./bin/prime --db
```

`--db` is not optional in CI: `darkroom`'s workflow has a `test-with-database`
job that sets the variable, and that job is the reason this repository's green
means anything.

### `muse` — the core-parity tests

```sh
MUSE_CORE_SCHEMAS=../core/schemas uv run pytest
```

Two tests skip without that variable, and they are the two that assert `muse`'s
copied event patterns are **byte-identical** to core's schemas and that its
`cafaye.yml` validates against core's manifest schema. A copy is a drift risk,
and this is the check that catches it — so a run without it has verified that
`muse` still agrees with the copy `muse` made of core.

The path is relative to `muse/`, so `../core/schemas` assumes a workspace
checkout. It is not `MUSE_CORE_SCHEMAS=core/schemas`.

### `pantry` — the drift tests need the whole fleet

```sh
PANTRY_CAFAYE_ROOT=/Users/kaka/Code/any/moon/cafaye ./bin/prime
```

`pantry`'s gate is green on a clone of `pantry` alone. The eight drift tests
look for a cafaye workspace — a directory holding `core/`, `identity/` and the
rest — next to the checkout or at `PANTRY_CAFAYE_ROOT`, and **without one each
prints `SKIP …` on stderr naming the directory that would make it run**, then
returns. A skip is reported, never hidden, and it is still a skip.

> A green `pantry` run on a clone by itself has verified **pantry against
> itself, not against reality.** It proves the registry is internally consistent
> and that every entry satisfies core's vendored schema. It proves **nothing**
> about whether any entry still says what its service says.

The gate additionally shells out to `../caf` to lint the registry entries. With
`../caf` present it runs; without it, it prints the two commands to run by hand
and continues. Two thirds of that gate are "against the fleet" and neither runs
on a clone.

`pantry`'s CI says so on its face: the `workspace-drift` job is **written out in
full and disabled with `if: false`**. It is disabled rather than absent on
purpose — an absent job is forgotten, a disabled one states that the coverage
does not exist yet.

### `kit` — needs a virtualenv

```sh
python3 -m venv .venv
.venv/bin/pip install -r tests/requirements.txt
bash tests/validate.sh
```

`validate.sh` looks for `$ROOT/.venv/bin/python` and falls back to `python3`,
then **exits 1 with `no python with PyYAML`** if neither can import `yaml`. On a
machine where a `PyYAML` lives in a system Python it will use that; on a machine
where it does not, the gate stops with one line naming the fix rather than
reporting a false pass.

Three phases, all of which must pass:

- **`static`** — every artifact parses, and the strictness decisions are still
  what they were written down to be: no exporter on by default, every compose
  port a `${KIT_*}` substitution, every placeholder documented with a default,
  every handed-out script executable, every OTel snippet parsing in its own
  language.
- **`telemetry`** — the six W3C `traceparent` templates are **executed**, one
  suite per language (Go, Ruby, Elixir, Python, Node, Rust). Stdlib-only and
  offline; a template that needed the network has grown a dependency and `kit`
  has stopped being config-only.
- **`self_test`** — breaks a throwaway copy of the tree **eleven ways** and
  asserts the gate goes red each time, each breakage caught by a *different*
  check. One of the eleven is a semantic mutation per language implementation.

A gate that has never gone red is a report, not a gate. `bash
tests/self_test.sh` on its own runs the eleven.

### `courier` — needs a database, and it says so

```sh
bin/dev                             # fetch kit's stack at kit.ref, up --wait, migrate
mise run prime                      # hex, deps, database, tests
mix precommit                       # warnings-as-errors, unused deps, format, test
```

The gate is `mix local.hex --force && mix deps.get && mix ecto.setup && mix
test`, and it needs a Postgres that nothing else is holding. `mix precommit` is
what runs before a commit lands.

**`bin/prime` does not start a database, and there is no `db` service to start.**
`courier`'s compose file calls it `postgres`, it belongs to kit's stack rather
than to `courier`, and it is published on `KIT_POSTGRES_PORT` (default `15500`)
— so `docker compose up -d db` is a command that cannot resolve on two counts.
`bin/dev` is how `courier` gets one; read the DSN out of the merged compose file
with `bin/dev stack` rather than assuming a port, because a DSN aimed at a native
Postgres on 5432 fails as `role "courier" does not exist` and reads like a missing
migration.

### `billing` and `cafaye-rb` — database in the gate, not outside it

Both `bin/prime` scripts run `db:prepare` themselves, so there is no tier to
miss — but they do need a reachable Postgres. `cafaye-rb` reads its test DSN
from **`CAFAYE_TEST_DATABASE_URL`**, which is a different variable name from the
`TEST_DATABASE_URL` that `identity` and `darkroom` use. Copying one repository's
`.env` into another is how you get a green gate that tested nothing.

### `core` — 75 checks, and it builds its own venv

```sh
bin/prime            # runs tests/setup.sh if tests/.venv is missing, then the suite
bin/prime --pytest   # the same suite through pytest, for a readable traceback
```

The script executes `tests/test_specs.py` directly rather than going through
pytest, and the suite is where every spec assertion lives: the event grammar, the
`fleet.yml` cross-checks in both directions, the payload-schema coverage, and
the telemetry schemas.

---

## What was true when this page was written

Point-in-time numbers, so you can tell a regression from a page that has gone
stale. **These are not promises**; run the gate.

| Repository | Last recorded gate |
| --- | --- |
| `core` | 75 / 75 |
| `courier` | 488 passed, 0 failures |
| `muse` | 765 passed, 0 skipped, 100% coverage |
| `darkroom` | 77 unit + 41 database, 0 failures |
| `billing` | 759 runs, 2087 assertions, 0 failures, 0 skips |
| `cafaye-rb` | 228 runs, 652 assertions, 0 skips |
| `kit` | `validate.sh` green, 11 / 11 self-test mutations red |

## The rule behind all of it

A suite that exits `0` with `ignored` tests has run less than it appears to, and
**the number it skipped is the number of claims nobody checked**. So:

1. Every skip is narrow and justified in the test itself — a condition the test
   states out loud, not a blanket "env var not set, skipping".
2. Where a skip is genuinely unavoidable, the gate has a second tier that runs
   it, **and CI invokes that tier**. A comment claiming CI runs it is not CI
   running it.
3. When you report a gate, report the **ignored count**, not just the exit code.

Three real examples of that shape going wrong, all of them invisible in the
exit code: `darkroom` printing `0 passed; 0 failed; 41 ignored`; `muse`'s two
core-parity tests skipping on an unset `MUSE_CORE_SCHEMAS`; and `pantry`'s eight
drift tests skipping on a clone.

## See also

- [Topology](/architecture/topology/) — where the drift audit is recorded.
- [Observability](/observability/) — the seven telemetry schemas and the one
  service that exports a signal.
- [Upgrading](/upgrading/) — what changed in the contracts, and in what order to
  move.
