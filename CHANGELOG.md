# Changelog

All notable changes to the cafaye documentation site are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The site is
unversioned at present — it is pre-launch and `package.json` carries `0.0.0`.

## [Unreleased]

### Fixed

- **The backup runbook was a procedure for a toolchain kit deleted.** It told an
  operator to run a script that is not there. kit-20 removed
  `templates/backup/`, `templates/bin/backup.sh` and `docker/Dockerfile.backup` —
  3,012 lines that reimplemented what `kamal-backup` already provides — and a
  previous rewrite of this page was **stashed rather than merged** because
  merging it would have shipped a runbook for a mechanism that no longer
  existed. All three paths verified absent.

  `runbooks/backup-and-restore.md` is rewritten against the mechanism that does
  exist: **`kamal-backup` 0.5.2 as an ordinary Kamal accessory**, dumping one
  Postgres per service with `pg_dump` and writing it through restic to a
  Cloudflare R2 bucket, on `backup.schedule: 1d`. The page no longer contains a
  `pg_dump` command the reader is expected to run by hand.

  What changed beyond the mechanism, and why each is load-bearing:

  - **The data-loss window is now stated.** A scheduled dump is not PITR: **up
    to one backup interval is lost if the primary database is destroyed, which
    with the shipped schedule is up to 24 hours.** The old page said "there is no
    point-in-time recovery" and left the operator to do the arithmetic.
  - **Four keys that make a dump unreadable are named, and three of them were
    absent from the old page entirely.** `RESTIC_PASSWORD` gates the whole
    repository; `MUSE_VAULT_KEY` gates `vault_secrets.ciphertext`;
    **`COURIER_SECRET_BOX_KEY` gates every `webhook_endpoints.secret`**, so
    without it courier cannot sign a single delivery; `MFA_ENCRYPTION_KEY` gates
    `mfa_credentials.secret_ciphertext`. The first three were read out of the
    service repositories' own source, not recalled.
  - **3-2-1 is claimed nowhere, because it is not met.** One repository, one
    backend, one provider. kit's own `templates/kamal/README.md` records that
    **R2 has no object versioning and no Object Lock — a deleted object there is
    gone and nothing here can bring it back** — so the mitigation is bucket
    access control, not the retention policy. The off-site half of the rule is
    the one that is met.
  - **"What is not backed up" is now specific to this platform** rather than
    general: `darkroom`'s object bucket (outside Postgres *and* outside restic,
    with `DARKROOM_OBJECT_STORE` defaulting to `memory`), Redis if you run it for
    `guard`'s rate limiter, Postgres roles and tablespaces — a `pg_dump` of one
    database carries no `CREATE ROLE` — and, if you also run kit's local stack,
    the Tempo/Loki/Mimir volumes, which delete their own contents on a
    1h/24h clock anyway.
  - **`billing` has four Postgres databases, not one**, and the backup covers
    only `billing_production`. That is correct — the other three are
    `solid_cache`, `solid_queue` and `solid_cable` — and the page now says why
    rather than leaving the old table's "one per install".

  **A second finding, and the more important one: no service has adopted any of
  it.** Checked across all seven service repositories on this branch — **none has
  a `config/kamal-backup.yml`**, which is the file that says what to back up and
  where to put it, and **only `billing` has a `config/deploy.yml` at all**, where
  it is the stock Rails-generated file whose `accessories:` block is commented out
  and which contains no backup accessory. A runbook that describes a working
  mechanism without saying that nothing is switched on is a runbook that reads as
  "you are protected", so the page now opens with a `:::caution` block saying so
  and pointing at kit's seven-step adoption list. Recorded here rather than fixed
  in `billing`: a service repository is read-only from this one, and adopting the
  template is kit's call, not this page's.

  **Two pieces of the old page's advice are now wrong, and both are the tool's
  job rather than the reader's.** It said to create a scratch database first and
  to pass `pg_restore --exit-on-error`. `kamal-backup` replaces the target schema
  itself (`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;` — which
  is what sidesteps `pg_restore --clean`'s foreign-key ordering failure) and then
  raises if `pg_restore` reported `errors ignored on restore: N`, so a partial
  restore cannot exit 0. Restoring into a database the application already
  migrated is the normal case, not the error case.

  **The old page's quoted command output is gone, and the replacement is real.**
  It presented `pg_dump` headers, a table of row counts and a `/readyz` body as
  *"real output from a verified restore"*. None of it can be reproduced against
  this mechanism. Every command on the new page was then **run** —
  `kamal-backup` 0.5.2 against `restic` 0.19.1 and PostgreSQL 18.4, taking a real
  dump into a real restic repository and restoring it — and the output quoted on
  the page is that output. What it bought, beyond the page reading as a
  procedure rather than a proposal:

  - **The claim that a count-only check reports an empty restore as a pass is now
    measured.** The same snapshot, containing a `users` table with three rows and
    an `audit_log` table with none, was drilled twice: `psql -tAc "SELECT count(*)
    FROM audit_log" --dbname=<scratch>` counted zero rows, exited 0, and the
    drill reported `status: ok`. The `ON_ERROR_STOP=1` + `RAISE EXCEPTION` form
    the gem's reference material does not use reported `status: failed` and exit
    1 with `ERROR: drill: table audit_log is empty in kitdemo_drill`. Two
    verdicts, one snapshot.
  - **A check that omits `--dbname` fails misleadingly**, and this was not
    predicted from the source: `FATAL: database "kaka" does not exist`, against
    the scratch database the drill had just created. It reads like a broken
    restore and is a missing flag. The page now says so, and says to run
    `--print-check` before trusting a hand-written check.
  - **The 24-hour window is measured from the previous backup's _finish_, not
    from the top of the hour**, so it is 24 hours *plus the duration of the dump*.
    The page quotes the tool's own two timestamps
    (`No backup due. Last backup finished at … Next backup is due at …`).
  - **A failed backup is not retried until the next interval** — the scheduler
    catches the error, logs it, and *then* sleeps the full 24 hours. But because a
    failure does not update the state file, a hand-run `kamal-backup backup` is
    already due and retries immediately. The runbook now says both, because
    "retried every 24h" read alone would leave an operator waiting a day for a
    backup they could have forced.
  - **The schedule state is a volume, and losing it loses the schedule.** With no
    writable `/var/lib/kamal-backup`, the tool cannot persist "last finished",
    so every invocation is treated as due: three full dumps in three minutes, with
    no complaint. That is what kit's `<service>_backup_state` mount is for, and it
    is why a rebuilt host does not know whether it is overdue.
  - **`forget_after_backup` is on by default**, so `restic forget --prune` runs
    after *every* backup, not only when asked.

  Two things the page deliberately still does **not** claim: the exact
  `postgresql-client` major version inside the accessory image (unverifiable from
  this repository, so the page tells the operator to read
  `tool_versions.pg_dump` out of `kamal-backup evidence` instead), and any
  capability claim sourced to a web page rather than to something in the fleet.

  **A drift finding, recorded rather than smoothed over: kit pins the accessory
  image to `0.5.2` and the current gem release is `1.0.0`.** The page is written
  against `0.5.2`, because the remote commands refuse to run when the local gem
  and the accessory image differ. Bumping the pin is a decision for kit, not for
  this page.

- **The site told buyers we have no observability, and `core`'s own record said
  the same thing.** Four pages carried a sentence that was false: *"Exactly one
  service exports any signal at all: `muse`"* (`observability.md`),
  *"`muse` is also the only service in the fleet that exports any telemetry"*
  (`services/muse.md`, `services/index.md`), and *"`muse` is the only service in
  the fleet that exports any signal"*
  (`security.md`). **`courier`, `billing` and `identity` each wire an
  OpenTelemetry SDK and export traces from their own code** — courier configures
  a batch processor over an OTLP exporter and installs its own span processor
  because the Erlang SDK cannot start one, billing installs a tracer provider
  with a request middleware, identity builds a batched tracer with retry and
  sending queue explicitly off. The record that said otherwise was
  `core`'s `fleet.yml`, which read `signals: []` for all three, transcribed on
  2026-09-30; the three SDKs landed on 2026-10-01 and nothing re-read them.

  `observability.md` now separates the three states the old sentence collapsed —
  **spec'd**, **instrumented**, **deployed** — in a table a reader can check
  row by row, with `core`'s `fleet.yml` named as the machine-readable version.
  Four services export traces; **none is deployed anywhere**, and that true
  negative is now stated as the narrow thing it is rather than as the whole
  story.

  Two more claims on the same page were false in the other direction, and both
  understated something real. *"the collector template ships with only the
  `debug` exporter, so a developer's laptop cannot send a span anywhere on its
  own"* is wrong: kit's collector fans out to Tempo, Mimir and Loki, and
  `tests/stack_live_test.sh` brings the fetched stack up, sends real OTLP and
  reads a trace back out of Tempo. And *"There is no shared error dashboard"* is
  wrong: kit provisions *cafaye — every error in the fleet*, twelve panels,
  grouped on span status. What does not exist is a dashboard maintained against
  a real incident, and that is what the page now says.

  The same denial was repeated in `getting-started.md`,
  `architecture/index.md`, `architecture/topology.md`, `security.md` and
  `pilot.md`, and all five are corrected. `topology.md`'s environment tables
  listed **no** `<SERVICE>_OTEL_ENDPOINT` at all, on a page whose job is "the
  variables each service actually reads"; there is now a per-service row and a
  fleet-wide one, and `darkroom` is named for what it actually does — the Rust
  `tracing` facade with its own `trace_id` in a task-local and no exporter, so
  its log records reach Loki through the collector's stderr receiver without an
  OTLP span existing.

  **One adjacent false claim found while verifying, in the same family.** `pilot.md`
  said `identity` *"is the only service with no dependency on another cafaye
  service"*. `darkroom` declares no dependencies either, and `courier` and
  `billing` declare empty lists, so the sentence was false in the way this packet
  is about: a uniqueness claim on one service that the fleet record contradicts.
  All four manifests were read to correct it.

  **One real drift found while checking, and recorded rather than smoothed over:
  `billing`'s `error.type` vocabulary is three values of its own**
  (`unhandled_exception`, `routing_error`, `middleware_error`) and **none of the
  three is in core's thirteen**, so a billing error span would fail core's
  `traces.schema.json`. `courier` and `identity` both carry all thirteen.
  `muse` still emits an exception class name. The `error.type` section now
  states which is which instead of "no service has been migrated", and the fix
  belongs to `billing`'s repository.

### Added

- **A check that the per-service telemetry table cannot drift from `core`.** The
  contract tier now reads `core`'s `fleet.yml` and asserts the table agrees in
  both directions — a service core records as exporting traces must be
  instrumented in the table, **and** a service the table calls instrumented must
  be one core records as exporting. The second direction is the one that catches
  this packet's subject: a table claiming a capability the fleet record does not
  have. It also fails if any row claims a service is **deployed**, and it flags
  any page asserting that one service is the only one exporting telemetry while
  core records four — which is the sentence three pages carried. That scan
  reports **8 offenders on the text before this commit and 0 after**.

  It was shown red before it was made green: run against a `core` that still has
  the old `signals: []`, it names all three services and the disagreement. The
  `core` version it reads is whichever `CORE_PATH` points at, so a stale sibling
  checkout makes this red rather than quietly blessing the table.

- **The contract tier's test count in CI is read, not written.** The `contracts`
  job's notice said `5 tests` while the tier held six — the same failure as a
  copied table, a number beside the thing it describes going stale in silence.
  It is now read out of the log by name, as the `gate` job's suite-size guard
  already does, and a missing count is an error rather than a zero.

- **`AGENTS.md`** records the new contract-tier check in both places that
  describe it, because a check this file does not mention is a check the next
  reader does not know exists.

- **`pricing.md`, `licensing.md`, `security.md`** — the three pages a stranger
  evaluating a purchase had no way to find, in one sidebar group
  (`Pricing, licence and security`) placed directly under `Hosted pilot` because
  the same reader reaches both. Each page is written to the same rule the rest of
  the site is: a claim is either a citation or it is not made.
  - **`pricing.md`** states the model — the code is free, we sell managed
    hosting, upgrades and support, you buy one of three units, `parlor` is free
    permanently — and then says the thing a price list usually hides: **nothing
    is purchasable today, and there is no price on the page.** All three paid
    products are given a table per unit, and each row's `today` column is a
    measured fact rather than an estimate. The seven undecided numbers are
    [listed on the page](https://docs.cafaye.com/pricing/) as questions for us
    rather than guessed, because a fabricated price is worse than a blank one.
  - **`licensing.md`** states the decision — MIT across the fleet, including
    every purchasable unit — and then the measured state, which is not the same
    thing: **seven of fifteen repositories carry no licence at all** and `muse`
    declares **AGPL-3.0-only**. It explains that GitHub's default for a public
    repository with no licence is "all rights reserved", that an intent is not a
    grant, and that **all three purchasable units are in the "nothing" row** —
    which is the one sentence on that page most likely to stop a purchase in
    somebody's own legal review. The re-derivation command is published on the
    page so the table can be re-run rather than trusted. It measures **committed
  `master`** with `git show HEAD:` rather than the files on disk, because a
  licence grant was being landed across the fleet in uncommitted working trees
  while this page was written — and reporting another worker's uncommitted work
  as a shipped fact is the exact failure this packet exists to prevent.
  - **`security.md`** covers credentials at rest, redaction, and the CI secret
    scan, with every claim pointing at a file: AES-256-GCM in `muse`'s vault and
    `courier`'s `SecretBox` and `identity`'s MFA vault (three languages, one
    design, three named non-defaults); argon2id for human-chosen passwords and
    SHA-256 for machine-generated tokens, with the reason from the source; the
    `Secret` type and `muse`'s prompt-and-completion **canary test**; and
    `kit`'s always-on `secrets` job — full history, `--redact`, pinned by a
    sha256 the repository owns, no network call, no dangerous trigger. It also
    names **ten repositories that run that scan and five that do not, `docs`
    among them**, lists the two unrotatable secrets and the JWKS revocation
    window, and states plainly that "never logged" is a mechanism in `muse` and
    not a fleet-wide log audit.
- **Six new findings in `README.md`, all re-measured rather than recalled** — see
  the Fixed section below for the two that changed a page.

### Fixed

- **`muse`'s auth is not a stub, and this site said it was in four places.**
  Measured at `muse` `e3f53b0`: the bearer token is verified against `identity`'s
  published JWKS with the algorithm **pinned to `RS256` at the decoder** rather
  than read from the token, `REQUIRED_CLAIMS` includes `account_id`, the
  operation's capability is checked separately from the signature, a token whose
  two authorisation claim names disagree is refused, and an unreachable key set
  is a `503` rather than a `401` — the service does not serve unauthenticated
  traffic when `identity` is down. Corrected in `services/muse.md`,
  `services/index.md` and the home page, each with the commit and a pointer to
  the measured detail. **`pilot.md` is deliberately not edited**: it is pinned to
  an earlier measurement and is the fleet's sell-readiness audit, so the drift is
  recorded as a finding on `security.md` and in `README.md` rather than resolved
  by rewriting the page that found it.
- **The licensing summary on the home page was wrong in three numbers.** It said
  one repository has a licence file, four declare one, and eight call kit's
  workflow. Re-derived on 2026-10-01: **three** carry an MIT licence file
  (`cafaye-py`, `cafaye-rb`, `cafaye-ts`), four declare MIT in a manifest, `muse`
  is AGPL, **seven state nothing**, and **ten** repositories call
  `ci.reusable.yml@master`. It also now says the decision — MIT across the fleet —
  alongside the gap, which is the pairing a buyer needs and the one the old
  sentence lacked.

- **`gate.yml`** — what `bin/prime` is worth in this repository, declared
  against `core`'s `schemas/gate.schema.json` and checked by
  `core/harness/bin/gate-check`. Six repositories declared their gate; this is
  the seventh. It exists because a green `bin/prime` here previously said nothing
  about whether the gate could detect anything: **the declaration names the whole
  gate, `./bin/prime --contracts`, and not the 16-test default**, because the six
  contract tests are the only ones that can catch a documented example
  contradicting something that has actually shipped, and declaring the subset
  would be declaring the badge. Eight `proof:` entries, five of them with a
  floor, each measured from a real run: the offline tier's 16, the contract
  tier's 6, 2 manifests through the real validator, 8 event-type claims against
  core's catalog of 30, and 6 span names against core's pattern. Four of the
  eight are anchored to the `== …` banner that precedes their tier, which is
  load-bearing: `node --test` prints **two** summary blocks under `--contracts`
  and the checker reads the last match, so an unanchored `^# pass ([0-9]+)$`
  silently reads the contract tier's 6 and a floor of 16 would be red on a fully
  green run. `external.selfContained` is `false` with four requirements whose
  failure messages were **demonstrated**, not predicted — including npm's, which
  is on *every* run here rather than once on a cold checkout, because `npm ci`
  deletes `node_modules` and reinstalls the lockfile each time.
- **Three red proofs, run.** A gate that has never been observed red is not a
  gate. `tests/links.mjs` and `tests/examples.mjs` removed from the `test`
  script: **`bin/prime` exited 0** at 7/7, and the declaration said
  `gate.floor: proof 'offline-suite' reported 7 and the declaration's floor is
  16`. `CORE_PATH` pointed at an empty directory: `gate.nonzero`, plus
  `gate.floor` and two `gate.proof-missing`, and **nothing skipped**. `CAF` set
  to `/usr/bin/true`: **all 22 tests passed, exit 0**, the tier still printed
  `manifests validated by caf contract lint: 2`, and the single thing that
  caught it was the proof that matches `caf contract lint`'s own stdout — the
  count-based proof was satisfied by the stub, because that line is printed by
  the test and not by `caf`.

### Fixed

- **`running-the-gates.md` claimed this repository has no CI.** It put `docs` in
  a "does not have a CI workflow" column and told the reader to "treat a badge
  on `docs` as an absence of evidence rather than evidence of absence". Both
  were true until docs-05 and neither was true after it: `.github/workflows/ci.yml`
  and `external-links.yml` have been on `master` since. The page is the fleet
  runbook, so a reader landing here was being told, in this repository's own
  prose, not to trust this repository. Its `docs` row also named only
  `bin/prime`, omitting the contract tier and both of the prerequisites that
  tier needs.
- **A stale count in `AGENTS.md`** — "26 external links" where the suite measures
  **50**. The other five counts on that line (103 shell fences, 11 JSON fences, 2
  manifests, 6 `caf` subcommands, 0 redirects) were re-measured and are correct.

### Added

- **CI, and a gate that is a real one.** `.github/workflows/ci.yml` with three
  jobs — `gate`, `contracts`, `pins` — and `.github/workflows/external-links.yml`
  for the network tier. The gate runs on the pinned interpreter and *asserts* it,
  holds the suite size by equality rather than as a floor, and fails if the gate
  left the tree dirty. The `contracts` job checks out `core`, builds `caf` from
  source and runs the contract tier; the `pins` job holds the configuration
  claims and needs no toolchain, so it fails in seconds.
- **`tests/links.mjs`** — the link half of the gate, and offline by
  construction. It asserts that every internal link's **`#fragment` names a
  heading that exists**, which nothing did before: `tests/smoke.mjs` strips the
  fragment and checks only the page, so a link into a renamed heading passed the
  whole suite. It also asserts that every internal link names a page that was
  built, that every configured redirect resolves and shadows no live page, and
  that every external href is a well-formed `https:` URL with a real host and no
  placeholder.
- **`tests/examples.mjs`** — the code examples, checked. Every ` ```sh ` fence
  parses under `bash -n`, every ` ```json ` fence is valid JSON, every ` ```yaml `
  fence is a manifest, and every `caf` invocation in a fence names a subcommand
  the `caf help` output **quoted in `getting-started.md`** lists — read out of
  this repository's own prose rather than from a list written beside it.
- **`tests/contracts.mjs`, and `bin/prime --contracts`** — the only tier that can
  catch an example contradicting something that has actually shipped. Every
  documented `cafaye.yml` goes through the real `caf contract lint` against
  core's real schema, as does this repository's own manifest; every event type a
  page says a service declares is checked against core's catalog; and every span
  name in `observability.md` is checked against core's `span-naming.schema.json`.
  It **fails with a message rather than skipping** when `core` or `caf` is
  missing, because a contract check that cannot find the contract is worse than
  no contract check.
- **`bin/check-external-links`** — the network tier, in its own file and on its
  own triggers (master pushes, a weekly schedule, and `workflow_dispatch`; never
  a pull request). It reports `ok`, `redirect`, `broken` and `unreachable` as
  four separate counts, because a summary saying "23/26 fine" is a claim about
  the site and only one of those four is "fine".
- **`mise run prime:contracts`** and **`mise run links:external`**, so both
  tiers are named commands rather than folklore.

### Fixed

- **A deep link that resolved to nothing.** `troubleshooting.md` pointed at
  `/runbooks/service-down/#darkroom--object-storage-is-a-separate-failure-from-its-database`,
  and the text it named is a bolded paragraph rather than a heading, so no such
  anchor was ever emitted and the reader landed at the top of the page. Found by
  the new fragment check against real content, before it was fixed — the first
  run of `tests/links.mjs` was red on this and nothing else.
- **Two JSON fences that were not JSON.** `upgrading.md` showed the two
  `billing.payment.succeeded` shapes in one fence with `//` comments, and
  `secret-rotation.md` put two consecutive responses in one fence. Neither is
  something a reader can paste into a request; both are now one document per
  fence, with the labels in prose.

- **Upgrading** (`src/content/docs/upgrading.md`) — a migration note for a
  self-hoster with a **running deployment**, not a changelog. Written for
  someone who has to do the work on a Sunday afternoon with a customer waiting.
  It opens by saying how urgent any of it is (no service starts an outbox
  publisher loop, so if you have not written your own, nothing is on a bus),
  then gives the order — **widen the consumer to accept both spellings, cut the
  producer, watch the old spelling reach zero, narrow the consumer** — because
  there is no order in which a consumer matching exactly one spelling is correct
  across the courier rename. It covers the three consumer-breaking changes: the
  three-segment courier event types, core D10's rewrite of
  `billing.subscription.started`, and the `oneOf` on
  `billing.payment.succeeded`; and it states the five-part rule for registering
  an event type.
- **Observability** (`src/content/docs/observability.md`) — the telemetry
  contract `core` owns, summarized: the seven schemas, the span-name grammar,
  the per-signal attribute allowlists, the ban on unbounded identifiers on a
  measurement, the redaction boundary for LLM content, `error.type`,
  `/healthz`/`/readyz` as schemas, and the `<SERVICE>_OTEL_ENDPOINT` contract
  with its no-op path. It leads with what is **not** true: no collector is
  deployed, no stack is running, exactly one service (`muse`, traces only)
  exports any signal, no service has been migrated to the bounded `error.type`
  vocabulary, and there is no shared error dashboard.
- **Running the gates** (`src/content/docs/running-the-gates.md`) — the exact
  command for every cafaye repository, and the tiers that do **not** run by
  default. `identity` needs `TEST_DATABASE_URL` **and a `goose up` first**
  (without it: `relation "public.oidc_clients" does not exist`, an error naming
  a relation rather than the missing step); `darkroom` has a `--db` tier plus a
  third tier (`--features s3`) that `cargo test` never compiles at all; `muse`
  needs `MUSE_CORE_SCHEMAS=../core/schemas` for its two core-parity tests;
  `pantry`'s eight drift tests skip without a workspace and need
  `PANTRY_CAFAYE_ROOT`; `kit` needs a virtualenv with PyYAML. It opens by
  saying CI is **not** fleet-wide and that `kit`'s reusable workflow is
  currently uncallable, with the five repositories that do have a workflow.
- `tests/smoke.mjs` — a fifth assertion, and the direction that was missing:
  **every content page is reachable from the sidebar.** The four existing tests
  are sidebar → disk, so a page on disk and absent from the navigation built
  fine, landed in `dist/`, and looked perfect. Written first, and it caught the
  new pages before they had sidebar entries — which is exactly the failure it
  exists to prevent.
- `tests/smoke.mjs` — a sixth assertion: **no built page contains an empty
  `<svg>`**, which is what an icon name Starlight does not know renders to. A
  `seti:`-prefixed icon is a valid Seti UI name and Starlight 0.42 has no `seti:`
  support at all, so the new Upgrading card shipped an empty element with no
  warning and no build failure. Written first, caught it red, then fixed to a
  name the icon set actually has.- **Every service page rewritten from its repository on `master`.** The status
  lines were the drift, and a reader who trusted one would have planned around
  a service that does not exist:
  - `darkroom` — was *"Status: not started… the repository exists and is
    **empty** — no manifest, no Dockerfile, no code."* Now: signed uploads,
    tenant-isolated variants, and **Cloudflare R2 through the same S3
    implementation** behind `--features s3`, with the four R2 differences and
    the read-back checksum as the consequence.
  - `courier` — was *"Status: v0 scaffold… deliberately **no notification logic
    yet**. There is no Swoosh, no provider adapter, no job queue, no preference
    store, and no migrations"*, and its manifest was recorded as failing
    `caf contract lint` over two-segment event types. Now: the Swoosh pipeline,
    preference store, Oban worker, six migrations, and outbound webhooks over
    the **Standard Webhooks** spec with an SSRF guard; the manifest is corrected
    and the event types carry the `courier.` prefix.
  - `billing` — was *"There is still no outbound Stripe call anywhere in the
    repository… There is no subscriptions table, no checkout, no portal"*. Now:
    the subscription lifecycle, three ways out to Stripe, and out-of-order
    webhook handling — **plus the open disagreement with core's payload schema**,
    stated rather than smoothed.
  - `identity` — was *"**Not built:** … the OIDC provider"*, with no
    `/.well-known` for `guard` to verify against. Now: the OIDC provider,
    discovery, client registration, auth code + PKCE, tokens and
    `/.well-known/jwks.json`. **MFA is called out as in flight, not shipped**,
    because a security model that assumes a second factor would assume it here.
  - `guard` — was *"an in-memory fixed-window rate limiter… the session store and
    the rate-limit counters are `Map`s in one process… Run one replica until the
    shared stores land."* Now: a sliding-window **GCRA** limiter that runs against
    **Redis** when `REDIS_URL` is set, plus scoped API keys and a per-route limit
    table. Sessions remain per process, and that is still called out.
  - `parlor` — was *"Three routes exist today: a landing placeholder at `/`,
    `/register`, and `/login`"* with *"Not built: settings, team and invitation
    management"*. Now: eight routes including the account surface, invitation
    redemption and two billing screens.
  - `muse` — records that it is **the only service in the fleet exporting any
    telemetry**, that the exporter stays out of the image by dependency rather
    than by convention, and that `error.type` is **not** migrated.
  - `services/index.md` — the status table, refreshed, with the three gaps a
    reader would otherwise plan around named in one line.
- `index.mdx` — *"Of the ten `caf` subcommands, four do real work… and
  `darkroom` is an empty repository"* is gone: **`caf dev` now works**, and
  `darkroom` is three milestones past that sentence. The tooling table no longer
  advertises `cafaye-py` and `cafaye-ts`, which **do not exist as repositories**;
  `cafaye-rb` is described as what it is — **the shared Ruby gem** (JWKS
  verification, transactional outbox, Rails railtie), not a generated SDK — and
  `pantry` as Rust rather than Go.

### Changed

- `README.md` — the content tree gains `upgrading.md`, `observability.md` and
  `running-the-gates.md`. The *Findings are recorded* section is replaced by the
  eight live drift-audit findings rather than the three it listed, and the CI
  section no longer describes a hypothetical `node` job: **the reusable workflow
  is currently uncallable** because it sits at `workflows/ci.reusable.yml` and
  GitHub only resolves reusable workflows from `.github/workflows/`.
- `AGENTS.md` — the gate section describes what `tests/smoke.mjs` now asserts,
  and adds a rule that did not exist because nothing forced it: **re-derive a
  claim before you keep it, do not inherit it.** Run the command; a table that
  was copied rather than re-run is a changelog. Plus the read-only boundary for
  service repositories, and a pre-commit item that asks whether every changed
  number was run.

- **The runbooks now tell you what the gates actually need.** This is the
  most useful correction in the packet, because a runbook that says "run the
  gate" without naming the environment is instructing the reader to verify
  nothing.
  - `runbooks/index.md` — **object storage is now the second thing to back up**,
    and `pg_dump` will not save it: `darkroom` hands out presigned writes into a
    bucket, so a restored database whose bucket is empty has every asset back in
    the `pending` state it was created in. Also states plainly that **most
    repositories have no CI**, and that `courier`'s outbound webhooks *are* real
    even though nothing publishes to a bus.
  - `runbooks/service-down.md` — **"Rate limits reset and multiply. Also per
    process"** is gone; the limiter is GCRA and Redis-backed when `REDIS_URL` is
    set, with `TRUSTED_PROXIES` as the header-trust dial and the socket peer as
    its default. Added `guard`'s Redis readiness 503 (which is not a request
    failure), `darkroom`'s object-store failures being separate from its
    database, `darkroom`'s startup refusals, and the third 8080 collision.
    Sessions remain per process, and it now says that `REDIS_URL` does **not**
    fix them.
  - `runbooks/secret-rotation.md` — the inventory had two rows saying "there is
    nothing to rotate here", and both were wrong. A **Stripe API key is now
    real** (billing makes three kinds of request to Stripe) and rotatable, and
    **`identity`'s OIDC signing key now exists** (`OIDC_SIGNING_KEY`, configured
    and never generated, with the token-encryption key derived from it). Section
    5 used to read "**The key set is not**: `identity` has no OIDC provider and
    publishes no `.well-known` endpoint" — it does both. It also records that a
    rotation *today* is a cutover rather than a rotation, because there is no
    overlap window, and that the derived key makes it one secret and not two.
    Added an object-storage credential row and schedule entry.
  - `runbooks/tenant-provisioning.md` — **"`courier` is a v0 scaffold with no
    Swoosh, no provider adapter, and no job queue, so nothing emails this
    token"** is now "the pipeline is built and no provider adapter is
    configured". Flags `identity.member.accepted` against core's
    `identity.member.joined`, and the five tenancy types `identity` emits without
    declaring.
  - `runbooks/billing-webhooks.md` — **"There is no API call in `billing` to pull
    events from Stripe — `billing` receives and never calls"** is gone; it calls
    in three ways, so there is an API key to rotate alongside the signing secret.
    Corrects the `subject` rule: a **subscription** event's subject is billing's
    own `Subscription#id` so the three join on one key, while **payment** events
    keep the processor's id. Adds the D10 divergence, with the instruction to
    prefer `GET /v1/subscriptions/{id}` over the payload as the source of truth.
  - `runbooks/backup-and-restore.md` — the table's **"(no migrations yet)"** for
    `courier` and **"does not exist"** for `darkroom` are replaced with what is
    actually in those databases, and `guard` gains a note that with `REDIS_URL`
    set, **Redis is the thing to back up or accept losing**.
- `troubleshooting.md` — the **"Uploads fail at 90%"** entry, which answered
  "there is no upload path today, `darkroom` is an **empty repository**", is
  rewritten around the three real failures (`409` at completion, `422` checksum,
  and the 1 GiB memory cost at complete time). The `caf contract lint` entry no
  longer names `caf` and `courier`. New entry: **"A suite is green and I do not
  believe it"** — the skipped-tier table, and the fact that eight of thirteen
  repositories have no CI at all.
- `architecture/index.md` — **"`darkroom` is an empty repository"** removed from
  the cost list; observability added as the third mechanism alongside HTTP and
  events, with the honest note that the contract is shipped and the stack is not.
- `contracts.md` — the five-part rule for a conformant event type, the fact that
  a manifest and what a service emits are two different lists (`identity`
  declares three and writes eight; `courier` declares five and publishes one),
  and a pointer to the telemetry schemas that `caf contract lint` also reads.
- `guides/index.md`, `runbooks/index.md` — the walkable-procedures list now
  includes Upgrading and Running the gates, and says five unbuilt commands rather
  than six.
- `tests/smoke.mjs` — a seventh assertion: **every internal link in the built site
  resolves.** AGENTS.md names a broken link as one of the two ways this
  repository breaks quietly, and nothing validated an `href`. Written first; it
  found a real one immediately (below), and it was proved to bite on a deleted
  page slug before being kept.

### Fixed

- **`/favicon.svg` is a 404 on every page.** Starlight's favicon schema is
  `z.string().default('/favicon.svg')` with no way to omit it, and this repository
  has no brand asset. Inventing a mark is a brand decision `astro.config.mjs`
  explicitly has not made, so the 404 is **recorded rather than fixed**: the link
  test asserts the set of referenced static assets equals exactly
  `['/favicon.svg']`, so a second missing asset fails the suite and the entry
  cannot quietly grow into an allowlist.
- **An icon that does not resolve shipped as an empty `<svg>`** — caught by the
  sixth assertion and fixed in the same commit.

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

### Added

- **Hosted Pilot Onboarding** (`src/content/docs/pilot.md`) — the path from
  nothing to a running deployment, for somebody who has already evaluated the
  platform and is now blocked. Second entry in the sidebar, above **Start
  here**, because it is read at a different moment by a different person.

  It opens by saying the thing that decides the deal before anything else:
  **there is no hosted cafaye.** `caf deploy` is a stub, so "hosted pilot" means
  you run it in your own infrastructure. Then, in order: what you get (seven
  services, what each owns, what each one will fail you on), **the licence
  position across all thirteen repositories** — ten state no licence at all,
  `muse` is AGPL-3.0-only, and the page says in as many words to get the grant
  in writing before building commercially — what it costs to run, and the four
  things that leave your infrastructure if you turn them on.

  The prerequisite check is `caf doctor`, and the ten-row toolchain table on the
  page **is** the `tools` table in `caf/internal/cli/doctor.go`, in that order,
  because that is where the requirement comes from. Step 3 is `caf contract
  lint`, whose output is greppable and which exits 1 on an invalid manifest *and*
  on a path holding none.

  The path itself is eight steps — install, clone `identity` (the only service
  with no cafaye dependency), lint the manifest, `caf dev --dry-run` then
  `caf dev`, apply migrations, first request, the two things a default stack
  does not mount, then tenant provisioning — and **every step carries the failure
  branch beside it**, because a step that cannot fail is not a step a stuck
  reader can use.

  Two things the page found by running it rather than reading about it:
  `caf dev` **does not run migrations and does not publish Postgres on a host
  port**, so the first request on a fresh stack is a bare 500 whose real reason
  (`relation "users" does not exist`) is only in the service's logs; and
  `caf dev` sets no `OIDC_*` or `MFA_*` variable, so `/.well-known/jwks.json`
  404s and the MFA management routes are unmounted. Both now have a recipe, and
  `getting-started.md` points at it.

  It closes with **what is not production-ready yet** — every row a fact about
  current code with where to check it — and a **"what this page does not
  verify"** section, because the steps that could not be run here are named on
  the page rather than left for the reader to guess.

- **A design-partner flow** on that page: what a pilot gives back (a real
  workload, the first breakage within a week, two hours twice, a write-up if
  they want one), what they get that a public user does not, and how to reach a
  human — including the four things that **do not** exist yet (a support
  address, a status page, an uptime record, an SLA).

### Changed

- **The whole path re-run against `identity@master`,** not just drafted. Six
  claims changed as a result and were corrected rather than kept:
  - **The session token is 43 characters, not 64.** It is 32 random bytes,
    base64url, unpadded. A number a reader would have counted.
  - **`caf contract lint` over the workspace is 31 manifests: 26 `OK`, 5
    `INVALID`.** Topology's drift audit now tables all five and says which one
    is a defect: `parlor`. Three of the others are **negative fixtures for
    `core`'s own conformance tests**, now tracked on `core`'s `master` rather
    than in a worker worktree, which exist to be rejected — the concrete reason
    a raw manifest count is worthless as a health signal.
  - **`caf contract lint` prints one line per manifest, not per repository.**
    `pantry` alone contributes ten, because its registry ships a copy of every
    service's `cafaye.yml`. The page said "one line per repository" and was
    wrong.
  - **`guard` proxies nothing; it does not "route nothing".** It serves
    `/v1/me` and `/auth/*`. `services/guard.md` already had this right; the
    summary did not.
  - **The event-count arithmetic was off by one.** Of the ten types `identity`
    writes, one has both a catalog row and a payload schema, six have a row and
    no schema, and **three** have neither — the two `oidc_client` types plus
    `identity.member.accepted`. The page said "three… and a fourth".
  - **`go install …@latest` writes to `$(go env GOBIN)`,** which under a version
    manager is not `$GOPATH/bin` and may not be on `PATH`. `caf: command not
    found` after a successful install is now a named failure branch on step 1,
    with the `go env GOBIN` fix.

### Fixed

- **Four pages said `identity` has no CI workflow.** It does. `identity` landed
  a workflow that calls `kit`'s reusable workflow *and* runs a second `gate` job
  which starts Postgres, migrates, and fails the build on a pass-count floor
  (1254 suite, 1166 behind `TEST_DATABASE_URL`), on **zero** `--- SKIP:` lines,
  and on 23 named security tests missing from the log. Corrected in
  `running-the-gates.md`, `troubleshooting.md`, `index.mdx`, `runbooks/index.md`
  and `pilot.md`. The reusable workflow now has **eight** callers
  (`caf`, `core`, `courier`, `darkroom`, `guard`, `identity`, `muse`, `parlor`)
  and **one** repository with no workflow at all: `docs`.

- **The contact list on `pilot.md` was missing `guard@cafaye.com` and
  `cafaye@cafaye.com`,** while claiming to enumerate what each repository
  declares. It now does, and it names the two repositories — `kit` and
  `parlor` — that declare no contact at all.

### Notes

- **The repositories moved underneath this packet, twice, and every claim was
  re-derived rather than inherited.** `identity` landed `identity-07` and `caf`
  landed `caf-05` while the page was being written; `core` landed `core-07`
  while it was being corrected. The CLI claims were re-checked against
  `caf@460acf3` — still ten commands, still five stubs, still ten tools in the
  same order, still six project checks, still a 4 GiB / 4 CPU floor — and the
  manifest count re-measured, which is why it is 31 and not 35. That the number
  moved twice in an hour **is** the argument for never quoting it, and both pages
  now say so in those words.
- Every command on `pilot.md` was run, against `caf` at `460acf3` and
  `identity` at `master` (`35c2576`): `go install`, `caf version`,
  `caf doctor`, `caf contract lint` (single manifest, whole workspace, and
  `kit`, which ships none), `caf dev --dry-run`, `caf dev`, the migration loop,
  `POST /v1/users`, `POST /v1/session`, `GET /v1/me`, the outbox query, and the
  JWKS, discovery and MFA 404s. The steps that could not be run — Linux, a
  production deployment, the MFA enrollment walkthrough, `muse`, Stripe — are
  named on the page itself, not only here.
- `caf doctor`'s exit code was checked in all three states: with a project, with
  no project at all, and `--help`. **It exits 0 every time.** It is a report,
  not a gate, and the page says so.
- `caf contract lint` exits 1 in all three interesting cases: an invalid
  manifest, a directory with no manifest, and `kit`, which ships none.
- The "every service is one stateless container" claim was re-derived from all
  seven Dockerfiles: all multi-stage, all `USER`-set to a non-root account, none
  declaring a `VOLUME`. `darkroom`'s Dockerfile is at `docker/Dockerfile` rather
  than the project root, and `caf dev` renders the right path because it comes
  from the manifest — checked rather than assumed.
- **One read-only repository was written to by accident and repaired.**
  `caf dev --dry-run` writes `caf.dev.compose.yaml` into the project directory
  even though it starts nothing, and the dry-run against `darkroom` left one
  behind. It was deleted immediately and `darkroom` verified clean at `bcaa2fe`.
  The behaviour is real and is now stated on the page.
- No dependency was added. No assertion was changed and no smoke test was
  removed: the suite is **7 tests before and after**. No screenshot of a
  terminal appears anywhere, because the repository's existing style uses none.
- Nothing under `moon/refs/` or in jumpstart-pro was read or used.

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