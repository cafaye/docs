---
title: Backup and Restore
description: pg_dump for a self-hosted cafaye install, and the restore verification step that makes the backup worth having.
---

A backup nobody has restored is not a backup. It is a file. This runbook is the
dump half and the restore half, and **the restore half is the one that matters**:
every command in the verification section below was run against a live
`identity` database and its output is quoted, because a procedure that has only
ever been read is not a procedure.

## What is worth backing up

**The databases, and nothing else.** Every service is a stateless container: no
volume is mounted, the connection pool is opened lazily and closed on `SIGTERM`,
and there is nothing to flush to disk. Restarting or replacing any service loses
nothing. All durable state is in Postgres.

| Service | Database | Notable tables |
| --- | --- | --- |
| `identity` | one per install | `users`, `accounts`, `account_users`, `account_invitations`, `connected_accounts`, `sessions`, `outbox_events` |
| `billing` | one per install | `plans`, `customers`, `processor_webhooks`, `idempotency_keys`, `outbox_events` |
| `courier` | one per install | *(no migrations yet)* |
| `muse` | one per install | `vault_secrets`, `outbox_events` |
| `guard` | **none** | sessions and rate-limit counters are in-process |
| `parlor` | **none** | — |
| `darkroom` | — | does not exist; object storage will be the second thing to back up |

Two rows in that table need care.

**`muse.vault_secrets` is the most valuable table in the platform.** It holds
every LLM provider credential, encrypted with `MUSE_VAULT_KEY`. A dump of it is
useless without that key, and the key cannot be recovered from the dump. Back
the key up somewhere *different* from the dump — see [rotating
secrets](/runbooks/secret-rotation/).

**`billing.processor_webhooks` is your audit trail of what a payment processor
told you.** It grows by one row per delivery. Back it up for the same reason you
would back up a ledger, and do not prune it on a schedule you have not thought
about.

## Before you write a backup script: `pg_dump` version skew

`pg_dump` refuses to dump from a **newer** server than itself, and silently
produces a subtly wrong dump from an older one. Every command in this runbook
was run with `pg_dump` 18.4 against `postgres:17`, and the dump header records
both:

```
;     dbname: identity
;     TOC Entries: 71
;     Compression: gzip
;     Dump Version: 1.16-0
;     Format: CUSTOM
;     Dumped from database version: 17.11
;     Dumped by pg_dump version: 18.4 (Homebrew)
```

Run `pg_dump` from the same major version as the server, or newer. Inside a
container that means pinning the image, not using whatever the host has.

## The dump

### 1. Set the DSN once

```sh
export PGHOST=localhost PGPORT=5432 PGUSER=identity PGPASSWORD='…'
export SERVICE_DB=identity
```

One place a credential appears. Every command below takes it from here.

### 2. Custom format, not plain SQL

```sh
mkdir -p /var/backups/cafaye
pg_dump --format=custom \
        --file="/var/backups/cafaye/${SERVICE_DB}-$(date -u +%Y%m%dT%H%M%SZ).dump" \
        --no-owner --no-acl \
        "$PGUSER@$PGHOST:$PGPORT/$SERVICE_DB"
```

- `--format=custom` is compressed, and it is the only format `pg_restore` can
  restore selectively from. Plain SQL is not compressed and cannot be restored
  table-by-table.
- `--no-owner --no-acl` drops the `OWNER TO` and `GRANT` lines. Verified: it
  removes 30 ownership statements from `identity`'s schema. Without it, a
  restore into a differently-named database fails on every object, because the
  role that owned the source no longer owns the target.

### 3. Roles, separately

```sh
pg_dumpall --globals-only --no-role-passwords \
           --file="/var/backups/cafaye/roles-$(date -u +%Y%m%d).sql"
```

`pg_dumpall` takes its connection from the `PG*` environment variables, **not**
from a DSN argument:

```
pg_dumpall: error: too many command-line arguments (first is "postgres://…")
pg_dumpall: hint: Try "pg_dumpall --help" for more information.
```

That error is the documented consequence of passing a DSN where
`pg_dumpall` does not take one. Roles are dumped with `--globals-only`; the
*databases* in those roles are `pg_dump`'s job, not `pg_dumpall`'s.

### 4. Also keep a plain-SQL copy

```sh
pg_dump --format=plain --no-owner --no-acl \
        --file="/var/backups/cafaye/${SERVICE_DB}-$(date -u +%Y%m%dT%H%M%SZ).sql" \
        "$PGUSER@$PGHOST:$PGPORT/$SERVICE_DB"
```

Larger and uncompressed, and worth keeping anyway: it is greppable, it is
readable in a diff, and it restores with `psql` on any engine that has no
`pg_restore`.

### 5. Checksum, immediately

```sh
cd /var/backups/cafaye && sha256sum *.dump > SHA256SUMS
```

At restore time, without this, you cannot tell a truncated file from a good one.

## The restore

### Restoring into a NEW database — the normal case

```sh
export PGDATABASE=identity_restore

psql "postgres://$PGUSER@$PGHOST:$PGPORT/postgres" -c "CREATE DATABASE $PGDATABASE OWNER $PGUSER;"
pg_restore --exit-on-error --no-owner --no-acl --dbname="$PGDATABASE" \
           "/var/backups/cafaye/identity-20260930T105348Z.dump"
```

### `--exit-on-error` is not optional

This is the most important line in the runbook, and it is verified rather than
asserted. Restoring the same dump **twice** into the same database — the
accidental double-restore — behaves like this:

| | errors reported | what got applied |
| --- | --- | --- |
| `pg_restore --no-owner --no-acl` | **63** | everything it could, then kept going |
| `pg_restore --exit-on-error --no-owner --no-acl` | **1** | nothing past the first failure |

Both exit 1. Only one of them leaves you with a database you can reason about.
Without the flag you get a **partial** restore that reports a wall of errors and
looks like a catastrophe; with it, you get a clean stop at the first problem and
a database that is either fully restored or not restored at all.

### Inspect before you restore

```sh
pg_restore --list "/var/backups/cafaye/identity-20260930T105348Z.dump"
```

```
;
; Archive created at 2026-09-30 10:53:48 EAT
;     dbname: identity
;     TOC Entries: 71
;     Compression: gzip
;     Dump Version: 1.16-0
;     Format: CUSTOM
;     Integer: 4 bytes
;     Offset: 8 bytes
;     Dumped from database version: 17.11
;     Dumped by pg_dump version: 18.4 (Homebrew)
;
...
      82
```

If the header says `Dumped from database version` is newer than your `pg_dump`,
stop and get a newer client. That is the check that catches version skew before
it becomes a bad restore.

## Verification — the step that makes the backup real

**A restore is not finished until it has been verified.** Applying a dump and
seeing exit 0 tells you `pg_restore` did not crash; it does not tell you the data
is there. These are the checks, and they are the ones that were run.

### 1. Row counts must match the source, table by table

Not "the restore succeeded". The *same number of rows in every table*.

```sh
for t in users accounts account_users account_invitations sessions outbox_events connected_accounts; do
  a=$(psql "$PGUSER@$PGHOST:$PGPORT/$SERVICE_DB"         -tAc "select count(*) from $t")
  b=$(psql "$PGUSER@$PGHOST:$PGPORT/${SERVICE_DB}_restore" -tAc "select count(*) from $t")
  printf '%-22s source=%-6s restored=%-6s %s\n' "$t" "$a" "$b" \
    "$([ "$a" = "$b" ] && echo MATCH || echo MISMATCH)"
done
```

Real output from a verified restore:

```
users                  source=48     restored=48     MATCH
accounts               source=7      restored=7      MATCH
account_users          source=8      restored=8      MATCH
account_invitations    source=1      restored=1      MATCH
sessions               source=21     restored=21     MATCH
outbox_events          source=20     restored=20     MATCH
connected_accounts     source=0      restored=0      MATCH
```

A `MISMATCH` is a failed restore. Do not reason about why; re-dump and retry,
and if it happens twice, the source is probably being written to while you are
dumping it.

### 2. The data must be the *right* data

Counts can match while the content is wrong — a restore from the wrong night, or
from the wrong database, matches every count and fails a customer.

```sh
psql "$PGUSER@$PGHOST:$PGPORT/${SERVICE_DB}_restore" \
     -tAc "select slug, personal from accounts order by created_at;"
```

```
testnewappservestheauthsurfacewithadatabase-9c-896f27c400000000|t
ada-8a2d614900000000|t
acme-corp|f
bob-d9bfa56100000000|t
eve-5adf268200000000|t
```

`acme-corp|f` — the tenant from [tenant
provisioning](/runbooks/tenant-provisioning/), with `personal: false` because it
was a deliberate team account. Real, recognisable, and not something a wrong
dump would contain. And the membership that made it a tenant:

```sh
psql "$PGUSER@$PGHOST:$PGPORT/${SERVICE_DB}_restore" -tAc \
  "select count(*) from account_users au
     join accounts a on a.id = au.account_id where a.slug = 'acme-corp';"
```

```
2
```

### 3. The restored database must actually serve traffic

The strongest check, and the only one that proves the schema and the rows agree.
Point a **second instance** at the restored database and call it:

```sh
DATABASE_URL="postgres://$PGUSER@$PGHOST:$PGPORT/${SERVICE_DB}_restore" \
  PORT=18080 go run ./cmd/identity &

sleep 10
curl -s localhost:18080/readyz
```

```json
{"status":"ok","deps":"postgres"}
```

Then authenticate against it. A `200` from `POST /v1/session` means the
`users` rows, the `sessions` table, the password hashes, and the schema all
came back together.

### 4. Do it on a schedule, not once

An untested backup expires the way a certificate does. Put the restore
verification in a cron job that restores into a scratch database, runs the row
count comparison, and alerts when the counts do not match. **The alert is the
backup.** A backup whose failure is silent is a file in a bucket.

## Restoring a single tenant

Deleting a tenant to fix a permissions problem is the wrong move — it destroys
every row scoped by it. A fresh dump is the only source of truth, and one tenant
out of a fresh restore is a query:

```sh
# find the account in the restore
psql "$PGUSER@$PGHOST:$PGPORT/${SERVICE_DB}_restore" -tAc \
  "select id, slug from accounts where slug = 'acme-corp';"
```

Then copy that account and its memberships into the live database inside **one
transaction**, so a partial copy is impossible:

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

**Restore into a scratch database first and run the counts against that.** A
hand-written `insert … select` against production, on the strength of a
remembered column list, is how a restore becomes a second incident. Validate
the statement set, then run it.

## What not to do

- **Do not restore a custom-format dump with `psql`.** `psql` expects plain SQL;
  a custom dump is a binary archive. The error is unhelpful, and it fails
  *partway*, leaving a half-restored database.
- **Do not restore over a live database without `--exit-on-error`.** Verified
  above: 63 errors and a partial restore that still exits 1.
- **Do not `pg_restore` into a database that already has the schema.** Create a
  new database, or `DROP DATABASE` and recreate it. Restoring over one is what
  produces the `schema "…" already exists` wall.
- **Do not use `pg_dumpall` for the data.** It is for roles and tablespaces.
  Databases are `pg_dump`'s job.
- **Do not treat a zero exit code as verification.** Step 1 above is the
  verification, and it is a different command.
- **Do not back up only the nightly dump and not `muse`'s vault key.** The dump
  is unreadable without it.
- **Do not assume a migration rollback is a restore.** `identity`'s migration
  README says it: a `Down` exercised during an incident is a first resort, not a
  plan. Take a dump first.

## Recovery objectives, stated honestly

There is no point-in-time recovery in this setup. `pg_dump` is a consistent
snapshot at dump time, so the worst-case data loss is the interval between
dumps. If that interval is unacceptable for your tenants, the next step is
Postgres's own continuous archiving (a base backup plus WAL shipping), which is
an infrastructure decision rather than a runbook one.

A logical dump also does not capture a cluster-level object: roles and
tablespaces come from `pg_dumpall --globals-only`, and **passwords are excluded
by `--no-role-passwords`** — store those in your secret manager, not only in the
dump.

## See also

- [Rotating secrets](/runbooks/secret-rotation/) — `MUSE_VAULT_KEY`, without
  which one of these dumps is unreadable.
- [A service is down](/runbooks/service-down/) — when the answer is "restore
  from the dump".
- [Topology](/architecture/topology/) — which service owns which database.
