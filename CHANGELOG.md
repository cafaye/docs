# Changelog

All notable changes to the cafaye documentation site are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The site is
unversioned at present — it is pre-launch and `package.json` carries `0.0.0`.

## [Unreleased]

### Added

- **Architecture** (`src/content/docs/architecture/index.md`) — what each service
  owns and why the boundaries are where they are: the `identity` and `billing`
  ownership boundaries, HTTP for questions versus events for facts, the
  transactional-outbox write path with its three load-bearing properties, why
  one language per service, and what the boundaries cost.
- **Topology** (`architecture/topology.md`) — the operator's reference. The
  service table (language, container port, local port, database, `core:` range),
  the liveness/readiness table with each service's 503 body, every environment
  variable for `identity`, `guard`, `billing`, and `muse`, the HTTP surface of
  each service, an ASCII dependency graph, a "what is not wired yet" table, and
  the three repositories `caf contract lint` currently fails on.
- **Runbooks** (`runbooks/`) — the §5 promise and the §8 risk control, as five
  procedures plus an index stating the two facts every one of them assumes
  (probe failures never leak; no service publishes events):
  - **Tenant provisioning** — a new customer's account end to end. Every status
    code and response body quoted from a live `identity` session: register,
    authenticate, confirm the personal account, create the tenant, invite,
    accept, promote, verify. Covers the 404-not-403 enumeration defence and the
    last-owner rule.
  - **Backup and restore** — `pg_dump` custom and plain format,
    `pg_dumpall --globals-only`, and a **restore verification** step: row counts
    per table, content that must be recognisably right, and a second instance
    serving traffic from the restored database. Includes the measured
    difference between `pg_restore` with and without `--exit-on-error`
    (63 errors and a partial restore, versus 1 and a clean stop).
  - **Rotating secrets** — an inventory saying which secrets are rotatable and
    which are not. The Stripe `STRIPE_WEBHOOK_SECRETS` overlap (no downtime, no
    restart), the muse vault's per-call credential resolution, the two-role
    Postgres overlap, and the two that cannot be rotated: `MUSE_VAULT_KEY` (no
    tooling; `key_version` is always 1) and `identity`'s signing key (no JWKS
    endpoint yet).
  - **A service is down** — which service, which kind of down, and what not to
    do. The liveness-versus-readiness decision table, the `deps: "none"` trap,
    courier's ~4.4s readiness under a dead pool, `guard`'s two identity
    variables, and why restarting a 200-`/healthz` service makes it worse.
  - **Billing webhooks failing** — inspect, replay, recover. The 200/400/503
    table (a 200 is *not* success; a 400 stored nothing, so there is nothing to
    replay), the `ignored:` versus `failed:` prefixes, the full verified Stripe
    type mapping, and why a replay is safe by construction — the UNIQUE index on
    `stripe_event_id` and the single envelope `id`.
- **Troubleshooting** (`troubleshooting.md`) — keyed by the symptom a user
  reports, each with what to check, what it usually means, and what to do: login
  loops back to sign-in, sign-in works but the API is 401, everything 404s,
  uploads fail, webhooks arrive and nothing happens, 5xx that a restart hides,
  403 on an account you own, members list with empty ids, Stripe webhooks
  failing, `muse` refusing to start, `caf` exiting 2, and "nothing is broken and
  nothing is happening".

### Changed

- **Getting Started** (`getting-started.md`) — rewritten as a six-step path that
  works: `caf doctor` → install → read the command table → `caf init` a project
  → run a service locally → deploy to your own infrastructure. Every command was
  run against a binary built from `moon/cafaye/caf`, and the output is quoted.
  The per-service local stacks, the migration commands (goose, Rails, plain
  SQL), the per-service Dockerfile table, and the liveness/readiness contract are
  all there, because those are what actually exist.
- **Home** (`index.mdx`) — the card grid now points at Architecture, Runbooks,
  and Troubleshooting rather than three pages that all described the platform;
  the caution box states the four-working-commands fact instead of "repos are
  coming online".
- **Guides** (`guides/index.md`) — no longer a bare placeholder. Points at the
  procedures that *are* walkable today, and says why they are runbooks rather
  than guides.
- **Services index** — the status table now matches the repositories, and links
  to Topology for the operational detail.
- **Service pages** — status lines corrected where they had drifted from the
  code. `identity` is no longer described as having no sessions, no password
  auth, and no accounts or roles; `billing` no longer says webhook ingestion is
  a later packet; `muse` is v1 core rather than a skeleton; `darkroom`'s
  repository exists and is empty; `courier` says plainly that it sends nothing.
  Each of those pages gained the operational facts an operator needs from that
  repository: the role hierarchy, the two `IDENTITY_*` variables, the JWKS TTL
  as a revocation window, the vault key's non-rotatability.
- **`astro.config.mjs`** — three sidebar sections added (Architecture, Runbooks,
  Troubleshooting). No existing entry moved, removed, or renamed.

### Fixed

Three claims the site made that are not true, all verified against the real CLI:

- `caf init my-saas` was documented. **`caf init` takes 0 positional arguments**
  and `caf init my-saas` is a usage error, exit 2. The command that takes a name
  is `caf new <name>`.
- `go build -o caf .` was documented. **It fails** — `no Go files in <path>`, exit
  1 — because the main package is at `cmd/caf`. `go build ./cmd/caf` is correct.
- `caf contract test` was documented. **There is no `test` subcommand**; the
  verbs are `lint` and `resolve`, and `caf contract test` exits 2 with
  `unknown contract subcommand "test"`.

### Notes

- **Verified against running code, not against prose.** The `caf` binary was
  built from source and every subcommand was executed. The tenant-provisioning
  and backup-and-restore flows were run end to end against a live `identity`
  with Postgres, and the muse vault key generator was run to confirm its output
  length and all three of its refusal modes. That is why the pages quote real
  output rather than describing it.
- **Four findings about the cafaye repos are recorded rather than papered
  over**, documented where an operator will hit them (Topology and
  Troubleshooting) rather than only in the packet report:
  1. `goose` **panics** on `identity`'s current migrations —
     `duplicate version 5 detected`, between `00005_accounts.sql` and
     `00005_connected_accounts.sql`. The command in that repository's own
     `migrations/README.md` therefore does not work.
  2. `GET /v1/accounts/{id}/members` returns only each member's `role`;
     `account_id`, `user_id`, and `created_at` come back empty.
  3. `identity`'s `/v1/accounts` routes are registered in code but absent from
     its `openapi/v1.yaml`, and it emits `identity.member.accepted`, which is not
     a row in core's catalog.
  4. `caf contract lint` fails on `caf`, `courier`, and `parlor` today. The
     `courier` failure is a genuine spec disagreement (two-segment versus
     three-segment event types), not a typo, and specs are manager-owned.
- No page claims a command, flag, endpoint, or environment variable that was not
  read out of a source file, a `cafaye.yml`, a `Dockerfile`, a
  `docker-compose.yml`, or a test.
- Nothing under `moon/refs/` or in jumpstart-pro was read or used.
- The navigation gained sections and nothing else. `pagefind: false` is
  unchanged, and no dependency was added.
- One Vite notice about a module level directive in `index.mdx` remains: it is
  Astro's own MDX asset-propagation pass, not a problem with the page.

## [0.1.0] — 2026-09-30

### Added

- Initial scaffold of the docs site: Astro 7.3.5 + Starlight 0.42.4, static
  output, no adapter, `site: https://docs.cafaye.com`.
- **Home** (`src/content/docs/index.mdx`) — what cafaye is in one paragraph,
  then the services and tooling tables mirroring the org README, with cards for
  the three entry points.
- **Getting Started** — installing `caf`, `caf init`, `caf dev`. Every command
  that has not shipped is marked *Coming soon* rather than presented as working.
- **Services** — an overview page and one page each for `identity`, `billing`,
  `courier`, `darkroom`, `muse`, `guard`, and `parlor`. Each page states the
  language, the role, and a status line saying what is built and what is not,
  sourced from PLAN.md §tree and each service's own README.
- **Contracts** — the `cafaye.yml` manifest format, the event envelope, and
  OpenAPI, summarized with links to `cafaye/core`, which is named as the source
  of truth.
- **Guides** — a placeholder that says so, and explains why no guide is written
  against commands that do not run yet.
- `/404` (`src/pages/404.astro`) with `disable404Route: true`, so this
  repository owns the route instead of colliding with Starlight's injected one.
- `bin/prime` — the gate: `npm ci && npm run build && npm test`.
- `tests/smoke.mjs` — asserts `dist/index.html` exists and is a non-empty HTML
  document, that every sidebar slug has a source file and reached `dist/`
  (expectations read from `astro.config.mjs`, not hardcoded), and that the
  services directory is not empty.
- `README.md` with run and deploy instructions, `AGENTS.md` with the
  conventions, `CHANGELOG.md`, `.gitignore`, `mise.toml` (node 22.19.0 — above
  Astro 7's 22.12.0 floor, so `npm ci` prints no engine warnings), and a draft
  `cafaye.yml` validated against core's manifest schema.

### Notes

- **Search indexing is off** (`pagefind: false`) and no analytics are present.
  Starlight ships `@astrojs/sitemap`, so the build emits `sitemap-index.xml`;
  that was not treated as "search indexing" to remove.
- No blog, no CI workflow, no lint or typecheck step. The build is the gate.
- `cafaye.yml` records one open decision for the manager:
  `language: typescript` for a static site, because core's `language` enum has
  no value for it.