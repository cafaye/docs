---
title: Backup and Restore
description: What cafaye's Kamal deployment actually backs up, the data you lose when a database is destroyed, and how to restore and prove it.
---

**A backup nobody has restored is a file.** This page is the dump half and the
restore half, and it is written against the mechanism that exists today:
`kamal-backup` running as a Kamal accessory, dumping Postgres with `pg_dump`,
and writing the result through **restic** into a **Cloudflare R2** bucket you
choose.

**How much of this was actually run.** Every command on this page was run, and
the output quoted below is real: `kamal-backup` 0.5.2 against `restic` 0.19.1 and
PostgreSQL 18.4, driving a real `pg_dump`, a real restic repository and a real
scratch database, including a drill whose assertion **failed** on purpose so the
failure output is quoted too. The flags were read out of the gem's own source and
`--help`, and the coverage claims were read out of kit's templates and the service
repositories' migrations rather than recalled.

Two things were **not** exercised, and both are environment rather than
mechanism: the commands are quoted here in their **accessory-exec** form, which
needs a deployed host you have SSH access to, and the repository was a local
directory rather than an R2 bucket. The gem treats both identically — it hands
`RESTIC_REPOSITORY` to restic — so what follows is verified against the same code
path your deployment runs.

:::caution[Status: the tooling is here, no service has adopted it yet]
Everything below describes what **`kamal-backup` does**, and every command in it
works. But **nothing in the fleet is taking scheduled backups today**, and the
reason is a missing file rather than a broken one.

Verified across the seven service repositories on this branch:

- **None of them has a `config/kamal-backup.yml`.** That file is what says what
  to back up and where to put it; without it there is no backup configuration to
  run.
- **Only `billing` has a `config/deploy.yml` at all**, and it is the stock
  Rails-generated file rather than kit's template — its `accessories:` block is
  commented out and there is no `backup` accessory in it.

So a self-hosted install is **not** protected until somebody copies kit's two
templates in, sets the four secrets, boots the accessory and drills it. Those
steps are [kit's `templates/kamal/README.md`, "Adopting
this"](https://github.com/cafaye/kit/blob/master/templates/kamal/README.md) —
seven of them, and **step 6, the drill, is the one that proves the first five
worked.** Until that has been done, treat this page as the specification for a
mechanism you have not switched on.
:::

## What replaced what

The previous version of this runbook documented kit's own backup distribution —
`templates/backup/`, `templates/bin/backup.sh`, `docker/Dockerfile.backup`, and
a crontab. **All of it was deleted**, along with the runbook, because shipping a
procedure for a tool that no longer exists is worse than shipping no procedure:
an operator follows it, it appears to work, and it protects nothing.

`kamal-backup` already did all of it — `pg_dump` piped into restic, a schedule
with "last finished" state in a volume so a reboot does not trigger a dump,
retention, repository initialisation, redacted reports, and a drill. kit now
ships three files and no tool of its own:

| File in kit | Copied to | What it is |
| --- | --- | --- |
| `templates/kamal/deploy.yml.erb` | `config/deploy.yml` | the Kamal config, including the `backup` accessory |
| `templates/kamal/kamal-backup.yml.erb` | `config/kamal-backup.yml` | what to back up, where, and for how long |
| `templates/kamal/drill.sh` | `bin/drill` | a restore drill that cleans up after itself |

**Ruby lives on your machine, not on the service.** The `backup` accessory is an
ordinary container that ships its own Ruby, so a Go, Rust, Elixir, Python,
TypeScript or Ruby service image never needs a Ruby runtime to be backed up. What
does need Ruby is **your** machine, because `kamal` is a Ruby gem — and
`kamal-backup`'s own `restore local` and `drill local` need the gem installed
too. The **scheduled backups do not**: the scheduler is a foreground loop inside
the accessory container, and it takes snapshots whether or not you have a gem.

## What is actually backed up

The whole of it, in one sentence: **one Postgres database per service, dumped
with `pg_dump`, written to restic in R2.** Nothing else.

| Service | Durable state | In the backup? |
| --- | --- | --- |
| `identity` | one Postgres: `users`, `accounts`, `account_users`, `account_invitations`, `sessions`, `api_keys`, the OIDC tables, the MFA tables | **yes** |
| `courier` | one Postgres: `notification_preferences`, `webhook_endpoints`, `webhook_deliveries`, `email_suppressions` | **yes** |
| `billing` | **four** Postgres databases: `billing_production` plus `_cache`, `_queue`, `_cable` | **primary only**, and that is correct — see below |
| `darkroom` | one Postgres registry (`assets`, `asset_variants`) **and the object bytes in a bucket** | **registry only. The bytes are not.** |
| `muse` | one Postgres: `vault_secrets` | **yes**, and unreadable without `MUSE_VAULT_KEY` |
| `guard` | no database at all | **nothing to back up** — see below |
| `parlor` | no server state at all; the session token is in the browser's `localStorage` | **nothing to back up** |

Four of those rows need a sentence, and the sentences are the reason to read
this section twice.

**`billing` has four databases and the backup has one, on purpose.** Only
`billing_production` holds anything a customer would miss: `customers`, `plans`,
`subscriptions`, `processor_webhooks`, `idempotency_keys`. The other three are
`solid_cache`, `solid_queue` and `solid_cable` — a cache of something derivable,
a queue of pending jobs, and Action Cable messages in flight. Backing those up
buys a second copy of state that is cheaper to rebuild than to restore, and a
restore path nobody drills. `processor_webhooks` **is** worth keeping: it is your
audit trail of what the payment processor told you, it grows by one row per
delivery, and it should not be pruned on a schedule nobody thought about.

**`darkroom`'s bucket is outside Postgres entirely, and outside restic too.** Its
`assets` rows hold a `storage_key` and metadata; there is no `bytea` column
anywhere in its migrations, because the bytes go straight to the bucket by
presigned `PUT`. A restored `darkroom` database whose bucket is empty has every
asset pointing at nothing: completing such an upload fails as **HTTP 409
`the object was not found in storage`**, and every other read of the asset is a
broken image. **The bucket is the second thing to back up and this page cannot
tell you how**, because how you back it up is a property of your bucket, not of
cafaye. Note also that `DARKROOM_OBJECT_STORE` defaults to `memory`, and
`memory` means uploads are lost on restart — so if you have not set it to `s3`
with a real `DARKROOM_S3_BUCKET`, there is nothing to back up *and* nothing to
lose, which is a worse problem than it sounds.

**`guard` has no database, and the state it does have is not backup material.**
Its browser sessions and its API keys are held in a bare in-process `Map` and are
gone on every restart and on every deploy, by design and independent of any
backup. Rate-limit counters are in-process too, *unless* `REDIS_URL` is set, in
which case they live in Redis. **If you run Redis, its data directory is a
volume on the host's disk and it is not in the restic repository** — losing it
resets your rate limits, which is an inconvenience and not an incident.

**`parlor` is a stateless Next.js frontend.** There is no server-side state to
lose. Its `NEXT_PUBLIC_*` values are baked in at build time, so it is rebuilt
rather than restored.

### The three things that are not covered, gathered up

1. **The object bucket.** Not in Postgres, not in restic, not restorable from
   this page. Your responsibility, and the one gap that loses customer-visible
   data.
2. **Anything in a container's ephemeral filesystem.** Deliberately nothing:
   `config/kamal-backup.yml` ships **no `paths:` key** and the accessory mounts
   no data volume, so a restic file snapshot is never taken. Every service image
   is a non-root build with nothing written to local disk, so this costs nothing
   — with one exception worth naming: `billing`'s `config/deploy.yml` declares
   `billing_storage:/rails/storage`, and `config/storage.yml` configures a local
   **Disk** service. That is the stock Rails scaffold rather than a cafaye
   decision, and its own comment in the deploy config says *"Recommended to
   change this to a mounted volume path that is backed up off server"* — advice
   nobody acted on, and advice restic does not act on for you. Nothing writes to
   it today (there are no attachments and no `active_storage_blobs` table), so it
   is a latent risk rather than a live one. **The day something attaches a file
   to a Rails model, that volume becomes real state and this page's "nothing on
   local disk" sentence stops being true.**
3. **Postgres roles and tablespaces.** The dump is
   `pg_dump --format=custom --no-owner --no-privileges` of a single database, so
   it carries no `CREATE ROLE` and no ownership. The role comes from how the
   Postgres accessory was provisioned, not from the backup. Restoring into a
   differently-named role means that role has to exist first.

And, if you also run kit's local stack for observability, a fourth: its
`tempo`, `loki`, `mimir` and `grafana` volumes are not in the backup — and
mostly could not be, because they delete their own contents on a short clock
(Tempo `block_retention: 1h`, Loki `retention_period: 24h`). Telemetry history,
not customer data. The stack's NATS volume is also not covered, though today
nothing publishes to it, so there is nothing in it to lose.

### The keys that decide whether a dump is readable

A restic repository is encrypted with `RESTIC_PASSWORD` and nothing else, so
**if you lose that, every snapshot in it is permanently unreadable** — including
the ones you have not lost yet. It is a different value from every application
credential, and it is the one most worth writing down twice.

Beyond that, three services encrypt data at rest, so a dump is unreadable in the
specific columns below without the key. Store these **somewhere other than the
repository** — see [rotating
secrets](/runbooks/secret-rotation/).

| Service | Variable | What it protects | Dump readable without it? |
| --- | --- | --- | --- |
| any | `RESTIC_PASSWORD` | the entire restic repository | **no — nothing at all** |
| `muse` | `MUSE_VAULT_KEY` | `vault_secrets.ciphertext` — every LLM provider credential | **no.** `muse` will not even start without it |
| `courier` | `COURIER_SECRET_BOX_KEY` | `webhook_endpoints.secret` — every webhook signing secret | **no.** courier cannot sign a single delivery without it |
| `identity` | `MFA_ENCRYPTION_KEY` | `mfa_credentials.secret_ciphertext` — the TOTP secret | **no**, if you have enabled MFA |
| `identity` | `OIDC_SIGNING_KEY` | not a column; the signing key OIDC tokens are verified against | service-wide breakage rather than unreadable rows |
| `billing` | — | nothing at rest | yes — but note `customers.processor_customer_id` is stored in plaintext, so the dump is sensitive PII |

## The honest data-loss statement

**A scheduled dump is not point-in-time recovery, and pretending otherwise is
the failure mode of every backup runbook ever written.**

- `config/kamal-backup.yml` ships `backup.schedule: 1d`, which the tool reads as
  86,400 seconds. **If the primary database is destroyed, up to one backup
  interval of committed transactions is gone — with the shipped schedule, up to
  24 hours.** Write that number down next to the promise you make a customer,
  because it is the number that matters when it is 2am.
- **The 24 hours is measured from when the previous backup _finished_, not from
  the top of the hour.** The scheduler's loop is *run a backup, then sleep the
  interval*, so one cycle is the interval **plus the previous run's duration**.
  And because `pg_dump` opens a single repeatable-read transaction, the snapshot
  is taken at the **start** of the dump — so the gap between two snapshot points
  is that whole cycle, never exactly 24 hours. Run `kamal-backup backup` without
  `--force` and the tool will tell you the two timestamps it is working from.
  Real output, run twice in a row:

  ```
  No backup due. Last backup finished at 2026-10-01T18:16:58Z.
  Next backup is due at 2026-10-02T18:16:58Z.
  Run `kamal-backup backup --force` to force a backup now.
  ```

- **A failed backup is not retried until the next interval.** The scheduler's
  loop catches the failure, logs it, and *then* sleeps the full 24 hours. A dump
  that has been failing for six hours has not been retried six times.
- **But you can retry it now**, and this is the operationally important half: a
  failed backup does not update the state file, so the recorded "last finished"
  timestamp stays old and the next `backup` is therefore already due. Run
  `kamal-backup backup` by hand and it retries immediately. **The alert is the
  backup** — if you are not watching the accessory's log, a nightly failure is
  invisible for a day, and a backup that has been failing for a week is not a
  backup.
- **The schedule lives in a volume, and losing the volume loses the schedule.**
  The "last finished" record is `/var/lib/kamal-backup/last_backup.json` inside
  the accessory, which kit's `config/deploy.yml` mounts as
  `<service>_backup_state`. That mount is what stops a reboot from triggering a
  full dump. Verified: with no writable state directory the tool silently cannot
  persist the record, so *every* invocation is treated as due and takes a fresh
  dump — three full dumps in under a minute in testing, and no complaint. So a
  rebuilt host does not know whether it is overdue, and an operator who deletes
  that volume turns a daily backup into one per invocation.
- There is **no WAL shipping and no base backup**. `pg_dump` is a consistent
  snapshot at dump time and nothing more. If a 24-hour window is unacceptable
  for your tenants, the next step is Postgres's own continuous archiving, which
  is an infrastructure decision rather than a runbook one — and note that
  `kamal-backup` will not do it for you.
- **`pg_dump` version skew is handled for you, but the margin is one major
  version and nothing is checking it.** `pg_dump` refuses to dump from a server
  **newer** than itself, and silently produces a subtly wrong dump against a much
  older one. kit's `config/deploy.yml` runs the Postgres accessory as
  `postgres:17-alpine`, so a client newer than 17 is the supported direction.
  **Read the actual client version rather than assuming it** — the accessory
  reports it, and the report is the version that takes your dump:

  ```sh
  kamal accessory exec --reuse backup kamal-backup evidence
  ```

  `tool_versions.pg_dump` is that number. If you ever bump the Postgres accessory
  past the major version the bundled client is on, **the dumps stop** and
  `kamal-backup` 0.5.2 contains no version check at all that would warn you
  first — the backup fails, the snapshot ages, and nothing tells you. If you need
  a newer server, pin a newer accessory image and re-run the drill.
- Retention bounds how far back a restore can reach, and the shipped policy is
  about 26 snapshots: every one from the last week, one a day back a month, one
  a week back two months, one a month back a year, two a year indefinitely. The
  oldest thing you can restore is roughly **a year**, and the newest is up to a
  day old.

## Take a backup by hand

The scheduler runs on its own. Do this when you want to know the answer to "are
the backups working" without waiting for the schedule.

```sh
# Boot the accessory if it is not already up. --reuse on every command below
# reuses the running container instead of starting a second one, which matters
# for a container whose volume holds scheduler state.
kamal accessory boot backup

# Take one now, ignoring the schedule.
kamal accessory exec --reuse backup kamal-backup backup --force

# What is in the repository, newest first.
kamal accessory exec --reuse backup kamal-backup list
```

`--reuse` reuses the running container instead of starting a second one, which
matters here: the second container would share the state volume and the two
schedulers would fight over it.

Real output from a first backup — note that the repository did not exist, and
`init_if_missing: true` created it before writing anything:

```
INFO restic repository not ready, running restic init
INFO backing up stream as databases/cafaye-docs-demo/primary/postgres.pgdump
Backup completed at 2026-10-01T18:16:58Z
database primary: 65922d94 at 2026-10-01T21:16:55.860187+03:00
```

Two things in that output are worth reading twice. The **path** is
`databases/<service>/<name>/postgres.pgdump`, and it is keyed on the `name:` you
chose in the config — so renaming `primary` orphans every existing snapshot,
because restic tracks by path. And **a snapshot id is printed on success**, which
is the id you can restore a specific moment from.

And `list`, which is the answer to "what is actually in there":

```
ID        Time                 Host                     Tags                                                          Paths                                                Size
---------------------------------------------------------------------------------------------------------------------------------------------------------------
65922d94  2026-10-01 21:16:55  cafaye-docs-demo-backup  kamal-backup,app:cafaye-docs-demo,type:database,database:primary,adapter:postgres  /databases/cafaye-docs-demo/primary/postgres.pgdump  4.440 KiB
1 snapshots
```

**The tags are the audit trail.** Every snapshot is tagged with the app, the
database name and the adapter, and `list` filters on the first two — so a
repository shared by several services still answers per service. `1 snapshots` on
the last line is restic's own pluralisation; it is not a truncation.

`backup` without `--force` is the same command in scheduled form: it will tell
you `No backup due. Last backup finished at …` and do nothing.

**Two commands are worth running before the first one.** The first is `check`,
which runs `restic check` over the repository metadata and is also what
`check_after_backup: true` runs after *every* scheduled backup — a repository
that has been silently losing blocks is the failure this catches, and it is only
detectable while there is still something to find:

```sh
kamal accessory exec --reuse backup kamal-backup check
```

```
using temporary cache in /var/folders/…/restic-check-cache-3414237169
create exclusive lock for repository
load indexes
check all packs
check snapshots, trees and blobs
[0:00] 100.00%  3 / 3 snapshots
no errors were found
```

`no errors were found` is the line you are looking for. Note what it does **not**
cover: without `--read-data-subset`, restic verifies the repository's structure —
packs, indexes, trees and blobs — without reading back every byte of every pack.
That is the cheap check, it runs after every backup by default, and it catches the
failure it is aimed at. It will not tell you a single pack is subtly corrupt; for
that you need a read-back, and nothing on this page runs one.

The second is `evidence`, which prints a redacted JSON record of the latest
snapshots, the latest `check`, the latest drill, the retention policy, and the
tool versions. **Keep the output.** It is the artefact that answers "are the
backups actually working" without putting a credential in a ticket:

```sh
kamal accessory exec --reuse backup kamal-backup evidence
```

```json
{
  "schema_version": 1,
  "kind": "evidence",
  "app_name": "cafaye-docs-demo",
  "generated_at": "2026-10-01T18:16:43Z",
  "databases": [
    {
      "name": "primary",
      "adapter": "postgres"
    }
  ],
  "forget_after_backup": true,
  "retention": {
    "RESTIC_KEEP_LAST": "7",
    "RESTIC_KEEP_DAILY": "7",
    "RESTIC_KEEP_WEEKLY": "4",
    "RESTIC_KEEP_MONTHLY": "6",
    "RESTIC_KEEP_YEARLY": "2"
  },
  "latest_database_backups": {
    "primary": {
      "id": "9abbc62f",
      "time": "2026-10-01T21:16:38.178613+03:00",
      "tags": [
        "kamal-backup",
        "app:cafaye-docs-demo",
        "type:database",
        "database:primary",
        "adapter:postgres"
      ]
    }
  },
  "latest_file_backup": null,
  "last_restic_check": null,
  "last_restore_drill": null,
  "image_version": "0.5.2",
  "tool_versions": {
    "pg_dump": "pg_dump (PostgreSQL) 18.4 (Homebrew)",
    "pg_restore": "pg_restore (PostgreSQL) 18.4 (Homebrew)",
    "mysql_dump": "unavailable",
    "mysql_client": "unavailable",
    "sqlite3": "3.51.0 2025-06-12 13:14:41 f0ca7bba1c5e232e5d279fad6338121ab55af0c8c68c84cdfb18ba5114dcaapl (64-bit)",
    "restic": "restic 0.19.1 compiled with go1.26.5 on darwin/arm64"
  }
}
```

Three fields in that record are worth knowing before you need them.

**`latest_file_backup: null` is correct here, not a fault.** It is `null` because
`config/kamal-backup.yml` configures no `paths:`, so no file snapshot is ever
taken — which is the deliberate decision kit's template documents. If you add a
`paths:` list, this field starts filling in, and its appearance is how you confirm
the list is doing something.

**`last_restic_check` and `last_restore_drill` are read from the state
directory**, and they read `null` in the run above because that run had no
writable state directory — the same thing that made every backup look due. On a
real accessory both are populated, and they are the two fields that turn this
document from a snapshot list into evidence: one says the repository was verified,
the other says a restore was performed and what it asserted.

**`tool_versions` is a skew detector.** `pg_dump` and `pg_restore` are reported
separately because they are the two whose versions decide whether a restore works
at all, and `mysql_dump`/`mysql_client` report `unavailable` on a Postgres-only
host, which is the correct answer rather than a gap.

Two things that will bite you, both from the tool's own source:

- **The local gem and the accessory image must be the same version.** Every
  command that shells out through Kamal compares them and refuses on a mismatch,
  naming the fix. The accessory is pinned to `0.5.2`, so that is the gem version
  you want locally: `gem install kamal-backup -v 0.5.2`.
- **The R2 bucket has to exist before the first backup.** `init_if_missing: true`
  initialises the *repository* inside a bucket you have already created; it does
  not create the bucket. This is the difference between "backups are on" and
  "backups are on after somebody created the bucket", and the failure mode is a
  service that believes it is protected for as long as nobody needs it.

## Restore

**This is the emergency path.** It replaces the live database. Read
[what is replaced](#what-restore-production-actually-does) before running it.

The order is fixed, and it is not negotiable: **stop the writers, restore,
verify, start.**

### 1. Stop the application

```sh
kamal app stop
```

A restore drops and recreates the schema. An application that is still running
will re-create objects underneath the restore, and you will spend the rest of the
incident working out which rows came from where.

### 2. Restore into the live database

```sh
kamal accessory exec -i --reuse backup kamal-backup restore production latest
```

Three things about that command, all of them from the tool's source rather than
from habit:

- **It asks you to type the app name and then `RESTORE PRODUCTION`**, and then
  confirm. That prompt needs a real terminal, which is what `-i` provides —
  without it you get `production restore confirmation required; rerun
  interactively` and nothing happens.
- **`--yes` does not work here, deliberately.** The tool rejects it by name and
  tells you the flag that does. For deliberate automation the flag is
  `--confirm-production-restore`; for a human recovering an incident, type the
  two words.
- **Pass `latest`, or pass a snapshot id** from `kamal-backup list`. Restoring a
  known-good id is better than restoring the newest thing, because the newest
  thing may be the thing that broke.

### 3. Start the application

```sh
kamal deploy
```

### What `restore production` actually does

So that nobody is surprised by the mechanism, this is what the tool does to your
Postgres — verified in the adapter, not inferred:

1. `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;` — the target
   schema is **replaced**, not layered over. This is deliberate: `pg_restore
   --clean` issues one `DROP` per object, and a foreign key that exists only in
   the target blocks those drops, after which every `CREATE` fails as "already
   exists" and no data is copied at all.
2. `pg_restore --clean --if-exists --no-owner --no-privileges`.
3. **A check that `pg_restore` reported no ignored errors.** `pg_restore` exits
   0 even when individual objects fail, printing only `errors ignored on
   restore: N`. A restore that half-applied and claimed success is worse than
   one that failed, so the tool raises on a non-zero `N` rather than letting you
   discover the damage later from the data.

**Consequence for the old advice.** You do **not** create a scratch database
first, and you do not need `--exit-on-error`: the tool owns both of those
decisions, and a restore into a database the application already migrated is the
normal case, not the error case.

**What it does not restore: the bucket.** A successful `restore production` on
`darkroom` gives you a database whose `storage_key` values point at objects that
may not exist. Restore the bucket separately, or expect broken images.

## Verify it by restoring it

Two levels, and the second is the one that matters.

### Level 1 — the repository is sound and current

```sh
kamal accessory exec --reuse backup kamal-backup list
kamal accessory exec --reuse backup kamal-backup check
```

`list` is the answer to "what is actually in there", and it is the first thing to
run when a restore fails, because "the snapshot I was told about does not exist"
is a much better failure than a restore that starts and produces nothing.

### Level 2 — the data comes back, and you checked it

**A restore you have never performed is a hypothesis.** `bin/drill` is how you
turn it into a procedure, and it is kit's wrapper around `kamal-backup drill`
for two reasons that were found by reading the gem rather than by trying it and
liking the result:

- **The gem leaves the scratch database behind.** Its `restore_to_scratch`
  validates the target and restores; nothing drops it. The published advice
  elsewhere is a two-step manual cleanup, and a step an operator has to remember
  after a failure is a step that does not happen after a failure.
  `bin/drill` registers its cleanup trap *before* the database exists and drops
  it with `WITH (FORCE)`, which is what makes it work when a half-failed drill
  has left `psql`'s own session attached.
- **The gem decides the drill passed by the exit status of the `--check`
  command**, and the check everyone writes is `psql -tAc "SELECT count(*) FROM
  users"` — which exits 0 for 0 rows, for 4,000 rows, and for a table that
  exists because `pg_restore` created it and copied nothing into it. **A restore
  of an empty database is reported as a successful drill.** `bin/drill` therefore
  generates a check whose exit status *is* the assertion, and it refuses to run
  without at least one `--table`.

That second bullet was measured, not inferred, and the measurement is the whole
argument. A snapshot containing a `users` table with three rows and an
`audit_log` table with none was drilled twice against the same snapshot — once
with a check that only counts, once with a check that asserts:

| the `--check` command | what it did | drill status | process exit |
| --- | --- | --- | --- |
| `psql --no-psqlrc -tAc "SELECT count(*) FROM audit_log" --dbname=<scratch>` | counted 0 rows and **exited 0** | `ok` | **0** |
| `psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --dbname=<scratch>` + a `DO` block that `RAISE EXCEPTION`s when `count(*) = 0` | raised on the empty table | `failed` | **1** |

The same snapshot, the same restore, two verdicts. **A count-only check is a
report, not an assertion** — and the gem, correctly, treats the exit status as
the verdict, so a report is what you get. The passing run's output, real:

```json
{
  "schema_version": 1,
  "kind": "drill_result",
  "status": "ok",
  "scope": "production",
  "operator": "kaka",
  "requested_snapshot": "latest",
  "databases": [
    {
      "snapshot": "8776d482",
      "adapter": "postgres",
      "filename": "/databases/cafaye-docs-demo/primary/postgres.pgdump",
      "target": "localhost/kitdemo_drill"
    }
  ],
  "files": null,
  "check": {
    "status": "ok",
    "command": "psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --dbname=kitdemo_drill <<'CAF_DRILL_SQL'\nDO $$\nDECLARE\nBEGIN\n    IF (SELECT count(*) FROM \"users\") = 0 THEN\n      RAISE EXCEPTION 'drill: table users is empty in kitdemo_drill';\n    END IF;\nEND\n$$;\nCAF_DRILL_SQL",
    "output": ""
  }
}
```

And the failing run's `error`, real, which is the sentence you want in a page
alert at 2am:

```
ERROR:  drill: table audit_log is empty in kitdemo_drill
CONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE
```

**`ON_ERROR_STOP=1` is what converts a `RAISE` into an exit status.** Without it
psql prints `ERROR:` and exits 0, and you are back to a report. And note what
`ON_ERROR_STOP` is *not* doing: the check has to name `--dbname` itself, because
nothing sets `PGDATABASE` for it.

**A check that forgets `--dbname` fails, and it fails misleadingly.** Verified:

```
psql: error: connection to server on socket "/tmp/.s.PGSQL.5432" failed:
FATAL:  database "kaka" does not exist
```

That is a drill reporting a connection failure against the *scratch* database it
just created, and it reads exactly like a broken restore. The database name came
from the OS user because nothing told psql otherwise. This is why `bin/drill`
generates `--dbname` explicitly rather than inheriting one, and why
`--print-check` is worth running before you trust a hand-written check.

So the drill is:

```sh
bin/drill --table users
```

Name the tables that hold content, repeat `--table` for each, and read it as the
question it actually asks: *did these tables come back with rows in them?*

```sh
bin/drill --table users --table accounts --table sessions
```

Four things to know before you run it:

- **It restores into a scratch database and drops it.** Your live database is
  not touched. The wrapper refuses a scratch name containing `prod` or `live`,
  and refuses the live database's own name.
- **It needs `psql` on your machine and network access to the Postgres
  accessory**, because it creates and drops the scratch database itself. If the
  accessory is not directly reachable — it normally is not, outside the host's
  Docker network — point it at a reachable address with `--database
  host:port`.
- **Run it from the service repository**, where `config/deploy.yml` lives. It
  reads the service name out of that file, so it cannot be pointed at another
  service's database by accident.
- **`--print-check` shows you the assertion without running anything.** Read it
  before you trust it.

### The same drill without the wrapper

`bin/drill` is kit's, and if you are not using kit's template the gem command is
one flag away. It is the same drill, and it is the same two caveats:

```sh
kamal accessory exec -i --reuse backup kamal-backup drill production latest \
  --database "$SERVICE_drill" \
  --check "psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --dbname=$SERVICE_drill -c 'select 1' " \
  --yes
```

The `--database` flag is the scratch database's name and it is **required** — the
gem refuses to guess, and prompts for it when it has a terminal. It also refuses
a target that looks like production, so this is the safety rail you keep.

Two caveats, both measured:

- **It does not create the scratch database, and it does not drop it.** The
  `--database` name has to exist before the drill and is still there afterwards —
  the gem's scratch-restore path validates the target and restores, and the only
  `DROP` it ever issues is a schema reset on a restore into the *live* database.
  Measured: a drill against `kitdemo_drill` left it populated with the restored
  rows and did not remove it. That is the first bullet above, and it is why the
  wrapper exists.
- **A passing `--check` that asserts nothing still passes.** The `--check` above
  is written as a placeholder shape — replace `select 1` with the real assertion
  from the measurement table, or you have built yourself the count-only check
  this section is about.

**The alert is the backup.** A backup whose failure is silent is a file in a
bucket. Wire the drill into something that pages a human, on a schedule, and keep
the output — because a drill that runs and is never read has verified nothing.
The gem records the last drill to the accessory's state directory either way, so
`kamal-backup evidence` will show you when a drill last ran and what it asserted;
that is the record, and reading it is the part that is still yours.

### Restoring a single tenant

Deleting a tenant to fix a permissions problem is the wrong move — it destroys
every row scoped by it. Get the rows out of a snapshot first.

`bin/drill` is the wrong tool here, because it drops the database it restores
into. Pull the snapshot down to your own machine instead, where you have a
`psql` and no credential to improvise:

```sh
kamal-backup -c config/deploy.yml restore local latest
```

`restore local` needs the `kamal-backup` gem and `restic` on your machine, and it
**infers Rails conventions only when `config/database.yml` exists** — which is
true for `billing` and false for the other six. For those, tell it where to
restore with `config/kamal-backup.local.yml`:

```
databases:
  - name: primary
    adapter: postgres
    url: postgres://localhost/identity_development
```

Provide `RESTIC_PASSWORD` and the local database password in your environment.
The tool refuses to run if `RAILS_ENV`, `RACK_ENV`, `APP_ENV` or
`KAMAL_ENVIRONMENT` says `production`, which is a guard worth keeping.

**`billing` is the awkward one, and the inference is thinner than it looks.** Its
`config/database.yml` `development:` block has no `url:` key — it has `adapter`
and `database` — so the tool infers **a database name and nothing else**: no host,
no user. The restore then connects over the local socket as the OS user, which is
what you want in development and is the reason nobody notices the difference
until they run it as a deploy user. If you are not on a developer machine, write
the `config/kamal-backup.local.yml` block above with an explicit
`postgres://localhost/billing_development` rather than relying on the inference.

Then you have the data locally, and a single tenant is a query:

```sh
psql -d identity_development -tAc \
  "select id, slug from accounts where slug = 'acme-corp';"
```

Copy that account and its memberships into the **live** database — a different
database from the local one you just queried — inside **one transaction**, so a
partial copy is impossible. The column lists below are `accounts` and
`account_users` as `identity`'s migrations define them, and both statements are
keyed so that re-running them is a no-op rather than a duplicate:

```sql
begin;

insert into accounts (id, name, slug, personal, created_at, updated_at)
select id, name, slug, personal, created_at, updated_at
  from accounts where slug = 'acme-corp'
on conflict (id) do nothing;

insert into account_users (account_id, user_id, role, created_at)
select account_id, user_id, role, created_at
  from account_users
 where account_id = (select id from accounts where slug = 'acme-corp')
on conflict do nothing;

commit;
```

**Validate the statement set against the local restore before you run it against
production.** A hand-written `insert … select` against a live database, on the
strength of a remembered column list, is how a restore becomes a second incident.

## Retention, and what `prune` will delete

The policy is written into `config/kamal-backup.yml` rather than inherited,
which is deliberate: those five numbers happen to be the gem's defaults today,
and a retention policy that lives in a dependency's defaults is a retention
policy that changes on a version bump.

| Key | Value | What it keeps |
| --- | --- | --- |
| `keep_last` | 7 | every snapshot from the last week, whatever else |
| `keep_daily` | 7 | one a day, back a month |
| `keep_weekly` | 4 | one a week, back two months |
| `keep_monthly` | 6 | one a month, back a year |
| `keep_yearly` | 2 | two a year, indefinitely |

Roughly 26 snapshots. `kamal-backup prune` applies it with `restic forget
--prune`, scoped per database and per file group. **The retention policy is the
only thing standing between you and an empty repository**, so treat a change to
these five numbers as a change to how far back you can recover, and not as
housekeeping.

## 3-2-1, and why this does not meet it

**This platform meets one of the three rules, and the two it misses are the two
that protect you from yourself.** Stating it this way is the point; the usual
failure is a runbook that claims 3-2-1 over a single bucket.

- **3 copies — no.** There is one restic repository. `prune` deletes from it by
  design, and nothing keeps a second copy.
- **2 media — no.** R2 is object storage. There is no second backend, no second
  provider, and no second account.
- **1 off-site — yes.** The repository is not on the host. Host loss, host
  destruction and a wiped VPS do not touch it. This is the rule that is met, and
  it is the one that covers the most common disaster.

**There is also no immutability, and this is worth stating separately because it
is the property people assume they have.** kit's own `templates/kamal/README.md`
says it plainly: **R2 has no object versioning and no Object Lock, a deleted
object there is gone, and nothing here can bring it back.** So `prune` deleting a
snapshot is final, and a credential compromise that deletes objects is final. The
mitigation is bucket access control — who can reach the bucket at all — not the
retention policy, which only ever removes snapshots the tool already decided to
remove.

What would actually meet 3-2-1: a second restic repository in a different
provider or a different account, written on a schedule you watch, and a
retention policy the platform itself cannot delete. None of that ships today.

## What not to do

- **Do not restore a dump with `psql`.** The dump is a custom-format binary
  archive; `psql` expects plain SQL, fails *partway*, and leaves you a
  half-restored database with an unhelpful error.
- **Do not restore into a database the application has already migrated without
  stopping the application.** This is the single most common way to turn a
  restore into a second incident, and the tool's schema reset is what prevents
  it — if you hand it a live writer, it has nothing left to protect you.
- **Do not use `restore production` as a way to look at production data.** That
  is what `restore local` and `bin/drill` are for. `restore production`
  requires typing two confirmation phrases precisely because it is the wrong
  tool for almost every situation.
- **Do not treat a zero exit code as verification.** The tool checks for
  `errors ignored on restore` and the drill asserts row counts, but "the command
  exited 0" is a different claim from "the data is there and it is the right
  data". Check a table you will recognise.
- **Do not back up only the dump and not the keys.** `RESTIC_PASSWORD` makes
  every snapshot unreadable without it; `MUSE_VAULT_KEY` and
  `COURIER_SECRET_BOX_KEY` make specific columns unreadable without them.
- **Do not back up only the database and assume `darkroom` came with it.** The
  bucket is the other half, and it is the half this page cannot do for you.
- **Do not assume a migration rollback is a restore.** A `Down` exercised during
  an incident is a first resort, not a plan. Take a dump first.
- **Do not add a `paths:` key casually.** The tool refuses suspicious roots
  (`/`, `/var`, `/etc`, `/root`, …) unless an operator opts in by name, and
  snapshotting object storage a second time buys a second copy of bytes that
  were never at risk at the cost of a second thing to restore. A service that
  genuinely keeps state on disk adds the list deliberately, and then this page's
  "nothing on local disk" sentence needs rewriting.

## See also

- [Rotating secrets](/runbooks/secret-rotation/) — `RESTIC_PASSWORD`,
  `MUSE_VAULT_KEY` and `COURIER_SECRET_BOX_KEY`, without which a dump is
  unreadable.
- [A service is down](/runbooks/service-down/) — when the answer is "restore
  from the snapshot".
- [Tenant provisioning](/runbooks/tenant-provisioning/) — creates the rows a
  restore is trying to bring back.
- [Topology](/architecture/topology/) — which service owns which database and
  every environment variable in one table.
