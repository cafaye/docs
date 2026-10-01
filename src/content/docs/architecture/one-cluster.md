---
title: One Cluster, Many Databases
description: The fleet's data topology — one Postgres, one database and one role per service, what actually stops a service reading another's rows, and how to tell whether that is still true.
---

**The fleet runs one Postgres, not one per service.** Every service that has a
database has its own **database** on that one server, its own **role** that owns
it, and nothing that lets it reach the other services' databases.

[Topology](/architecture/topology/) is the operator's table — ports, probes,
variables. This page is the thing that table cannot hold: what the boundary is,
what it costs, and **how to check that it is still there**, because the way it
fails is silently and in the direction of too much access.

Every command and every block of output on this page was run against a cluster
built by `kit`'s own `templates/compose/postgres/initdb/10-cluster.sh` at the
ref in your `kit.ref`. The port in a connection error is the port you connected
on.

## The short version

| | |
| --- | --- |
| Postgres servers | **one**, in `bin/dev`'s stack, published on `KIT_POSTGRES_PORT` |
| Isolation boundary | **the database**, not the machine and not the role |
| Databases | one per service, named after the service |
| Roles | one per service, `NOSUPERUSER`, named the same, with a connection limit |
| Pooler | **none** — direct connections and a stated budget |
| Extensions | in the image, created by the admin role into every service database |
| What is **not** automatic | a database created after the volume was provisioned |

## One cluster, and what that changes

Three services — `identity`, `billing` and `courier` — reach their database
through `bin/dev`, which brings up **one** Postgres container and gives each of
them a database inside it. A service names itself in `KIT_POSTGRES_DATABASES` in
its `.env` and gets a database and a role with that name; it does not get a
container, a port or a volume.

```sh
# in a service's .env
KIT_STACK_NAME=identity                    # the prefix on the container and the volume
KIT_POSTGRES_DATABASES=identity            # kit's shipped default is 'courier'
```

**What sharing the server actually costs you**, because "one cluster" is a
choice and not a saving:

- One service's runaway query occupies shared resources until it finishes.
  Bounded per role, not prevented.
- One service's pool, left unbounded, can take the connections the others need.
  Bounded per role, not prevented.
- One service's forgotten `BEGIN` holds a snapshot open, which blocks `VACUUM`
  for everyone. Bounded per role, and this is the one that would have been one
  service's problem on a machine of its own.

All three are handled the same way, by the cluster rather than by a pooler —
[the connection budget](#the-connection-budget) below.

**And what it does not change:** `darkroom` and `muse` do **not** use this
cluster today. Each still ships a complete `docker-compose.yml` with its own
`postgres:17-alpine`, published on 5432 and 5433. `kit`'s fleet gate names both
as carrying their own copy of the shared platform, so this is debt with a name
rather than a design; see [the drift audit on the topology
page](/architecture/topology/#cross-repo-drift-audit).

## The database is the boundary, not the role

It is tempting to say a service is isolated because it has its own login.
It does not. **A role can hold `CONNECT` on a database that is not its own**, and
the moment it does, "cannot read another service's data" becomes a `GRANT`
somebody has to remember to withhold. Measured on a cluster of this shape, one
statement is the whole difference:

```sh
psql -d cafaye_platform -U cafaye -c 'GRANT CONNECT ON DATABASE billing TO courier;'
psql -d billing -U courier -c 'select current_database(), current_user;'
```

```
 current_database | current_user
-----------------+--------------
 billing          | courier
```

So the mechanism is the **database**, and it is a `REVOKE`:

```sql
REVOKE ALL ON DATABASE billing FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE billing TO billing;
```

Postgres grants `CONNECT` on every database to `PUBLIC` **by default**. A cluster
provisioned without that first line has, by default, **no isolation at all**:
every role in the fleet can open every database. The tables are still protected —
by the accident that nobody granted `SELECT` — while the database itself is wide
open to catalog enumeration, temp tables, and any future `GRANT` anywhere in the
cluster. **It fails open, silently, and one careless grant makes it fail for
real.**

What that looks like from outside, which is the shape you should recognise:

```sh
psql -d billing -U identity -c 'select * from users;'
```

```
psql: error: connection to server at "localhost" (::1), port 15500 failed: FATAL:  permission denied for database "billing"
DETAIL:  User does not have CONNECT privilege.
```

The refusal happens **before a query is parsed**. Nothing is logged as a
permission failure on a table, because no query was ever read.

## How to tell whether isolation is actually in place

This is the part that matters, because the failure mode is silence: a cluster
with no boundary answers every query a service sends, so the only evidence is
the absence of an error, and nothing reports an absence.

**Run this.** It is the whole check — one query, and it names the databases that
are open rather than telling you that things are fine:

```sh
export PGPORT=15500 PGPASSWORD=cafaye     # or whatever bin/dev printed
psql -h localhost -U cafaye -d cafaye_platform -X -c "
SELECT datname AS database,
       has_database_privilege('public', datname, 'CONNECT') AS public_may_connect
  FROM pg_database WHERE NOT datistemplate ORDER BY datname;"
```

A cluster with the boundary in place answers `f` on every row:

```
    database     | public_may_connect
-----------------+--------------------
 billing         | f
 cafaye_platform | f
 courier         | f
 darkroom        | f
 identity        | f
 muse            | f
 postgres        | f
(7 rows)
```

`cafaye_platform` and `postgres` are in that list on purpose. `postgres` is the
image's own maintenance database, which the official image creates **before** any
init script runs, and a contract that only revoked the databases it knew about
would leave it open. Read the query as a sweep over every database rather than a
list you maintain.

**The one-line version, for a script or a check:**

```sh
psql -h localhost -U cafaye -d cafaye_platform -X -tAc "
SELECT coalesce(string_agg(datname, ' '), 'none') FROM pg_database
 WHERE NOT datistemplate AND has_database_privilege('public', datname, 'CONNECT');"
```

`none` is the answer you want. **A database name is a finding**, and the fastest
way to be sure which one is to run the query above rather than to reason about
which databases ought to be there.

### What an open database actually looks like

Measured, on a cluster where a database was created the way an operator creates
one — `CREATE DATABASE`, with nothing else:

```sh
psql -d cafaye_platform -U cafaye -c 'CREATE DATABASE guard OWNER guard;'
psql -d guard -U courier -c 'select current_database(), current_user;'
```

```
 current_database | current_user
-----------------+--------------
 guard           | courier
```

And from inside it, the whole cluster is enumerable:

```sh
psql -d guard -U courier -X -tAc 'select datname from pg_database order by datname;'
```

```
billing
cafaye_platform
courier
darkroom
guard
identity
muse
postgres
template0
template1
```

The sweep query above reported `guard` and nothing else. That is the entire
diagnosis: **one database name, and you know which one is open.**

Closing it is the same statement the contract carries, and it is not optional
bookkeeping:

```sh
psql -d cafaye_platform -U cafaye -c 'REVOKE ALL ON DATABASE guard FROM PUBLIC;'
psql -d cafaye_platform -U cafaye -c 'GRANT CONNECT, TEMPORARY ON DATABASE guard TO guard;'
```

`courier` is then refused at the door with the same `FATAL:` as before, and the
sweep answers `none`.

### Why this cannot be made automatic

`docker-entrypoint-initdb.d` runs **once per volume**. The sweep at the end of
kit's init script therefore applies to every database that existed when the
volume was created and to none that is created afterwards — there is no way to
re-apply it from inside the script, because the database does not exist yet when
the script runs. A periodic sweep over `pg_database` would close the gap and is a
scheduled job and a new thing to operate.

**So the honest position is:** the boundary holds **by construction** for every
database declared in `KIT_POSTGRES_DATABASES` on a fresh volume, and a database
added afterwards is the operator's to close. That includes the scratch database
a [restore drill](/runbooks/backup-and-restore/#level-2--the-data-comes-back-and-you-checked-it)
creates, and any database you create while debugging.

**How to check the whole shape rather than the one property**, including that
each service's role exists, is not a superuser, and has a connection limit:

```sh
psql -h localhost -U cafaye -d cafaye_platform -X -c "
SELECT r.rolname, r.rolsuper, r.rolconnlimit,
       (SELECT count(*) FROM pg_database d WHERE d.datname = r.rolname) AS has_database
  FROM pg_roles r
 WHERE r.rolname IN ('identity','billing','courier') ORDER BY r.rolname;"
```

```
 rolname  | rolsuper | rolconnlimit | has_database
----------+----------+--------------+---------------
 billing  | f        |           10 |             1
 courier  | f        |           10 |             1
 identity | f        |           10 |             1
(3 rows)
```

## Adding a service to the cluster

`bin/dev` has a command for it, and it **prints the statements rather than
running them**:

```sh
bin/dev db grant parlor
```

The output names your port, your admin database and your password, and gives you
the statements in the order kit's init script uses — `CREATE ROLE`, `CREATE
DATABASE`, then the `REVOKE`, then the per-role limits. It prints because these
are `CREATE ROLE` and `CREATE DATABASE` on a cluster your service is about to be
handed credentials for, and a wrapper whose failure mode is *half-provisioned*
is not something to perform on a stack it did not start.

**Then add the name to `KIT_POSTGRES_DATABASES` in your `.env`**, so a fresh
volume provisions it without any of this. The statements are for the volume you
already have; the `.env` line is for the next one.

**The three ways people get this wrong**, all of them measured:

- **Naming the service in `KIT_POSTGRES_DATABASES` and running `bin/dev up`.**
  Nothing is created. The init script only runs on a fresh volume, so the
  service comes up with no database and its migrations fail against one that was
  never created. `bin/dev down -v && bin/dev up` does work, by deleting your
  data.
- **Creating the database by hand and stopping there.** You get a database every
  role in the cluster can open. The sweep query above names it.
- **Creating the role and the database and skipping the `REVOKE`.** Same hole,
  and it looks like a completed setup, because the service now connects
  successfully.

**`billing` is the one service with a trap here, and it is worth knowing before
you are surprised by it.** Its `config/database.yml` names its development
database after the **checkout directory**, not after the service — `billing` for
a plain checkout, `wt_billing_21_development` for a worktree at
`wt-billing-21` — and it only uses the database called `billing` when
`DATABASE_URL` is set, which is what its own compose override does. Under
`bin/dev` that is the shared cluster's `billing` database and it works. **Run it
from the host with no `DATABASE_URL` and it looks for a name kit never
provisioned**, and two worktrees of `billing` want two different names, which on
one cluster means they collide unless you provision both. Set
`BILLING_DATABASE_NAME` to a name you have provisioned, or add the derived name
to `KIT_POSTGRES_DATABASES`.

## The connection budget

`max_connections` is raised from Postgres's default of 100 to **200**, and each
role is capped:

```sh
psql -h localhost -U cafaye -d cafaye_platform -X -c 'SHOW max_connections;'
```

```
 max_connections
-----------------
 200
(1 row)
```

```sql
ALTER ROLE courier CONNECTION LIMIT 10;
```

**Ten is this service's share of the fleet's connections, and the cap is the
point.** A pool that grows without bound exhausts its own service's allowance
rather than refusing connections for the others — so the blast radius of one
service's leak is one service.

The arithmetic: at ten each, 200 buys twenty services at a full share. `kit`
sizes its own reasoning for nine, which is 90 and leaves the rest in reserve.

**`kit`'s gate checks the arithmetic, which is worth knowing exists** — the budget
is verified where it is declared rather than discovered at run time. The check is
`the connection budget (max_connections covers the declared topology)` and it
requires `max_connections >= databases x role limit + 8 reserved`, against kit's
own declared topology:

```
budget: 200 >= 1 db x 10 + 8 reserved = 18
```

**That is the shipped default, with one database declared, and it is nowhere near
the ceiling** — which is the point of stating it. 200 was chosen for a fleet of
nine, and the check is what makes adding databases one at a time a decision
rather than an accident.

The reasoning the check is built on is worth carrying: with no pooler in the
path, **a service that cannot get a connection cannot reach another service's
data, so an undersized budget shows up as a total outage rather than as a
refused query.** That is why the budget is part of the isolation story and not a
tuning knob.

**What happens at the limit.** The server refuses the connection and says so by
name, immediately:

```sh
psql -d courier -U courier -c 'select 1;'
```

```
psql: error: connection to server at "localhost" (::1), port 15500 failed: FATAL:  too many connections for role "courier"
```

**A service will usually not show you that error.** A driver with a pool queues
for a free connection instead of failing, so the request waits for the pool and
then times out, and the timeout is what reaches your logs. `courier`'s readiness
probe is the documented example: with a database gone from under a warm pool it
takes about **4.4 seconds** to answer `503`, which is the pool's queue
backpressure rather than the query timeout. The server's message is in the
Postgres log, not in the service's:

```sh
docker logs <pg-container> 2>&1 | grep -i 'too many connections'
```

The container is compose's, and it is named after the **compose project**, not
after the service or the directory: the container is `cafaye-postgres-1` and the
data volume is `cafaye_postgres-data` unless you have set `KIT_STACK_NAME`. Its
image is **`kit-postgres:17`**, a locally built one, rather than the pulled
`postgres:17` you would recognise, so `docker ps` is the fastest way to find
both.

**`KIT_STACK_NAME` is the line that keeps two checkouts apart, and on a shared
cluster it is worth more than it was.** It is the prefix on every container,
volume and network, so two services left on the default would collide on the host
port **and share one Postgres data directory** — which, with one cluster, means
`identity`'s volume holding `billing`'s database too. kit's `.env.example`
defaults it to `cafaye` and says to set it to your own name; the `.env` a service
gets is written on first `bin/dev up` and no service repository carries one in
tracked files, so **it is your `.env`, not the repository, that decides this**.
Check it before you bring a second checkout up.

### When a service genuinely needs more than ten

Raise it in **two** places, and say why in the change:

1. `KIT_POSTGRES_ROLE_CONNECTIONS` in the `.env`, which is what the cluster
   applies at init — and it only applies on a **fresh volume**. On a volume that
   already exists, run `ALTER ROLE <name> CONNECTION LIMIT n;` yourself.
2. **The pool size in the service's own database config**, and in the right
   direction. The cluster's per-role limit is the outer cap and the pool is the
   inner one. **A pool larger than the role limit does not give the service more
   connections, it gives it errors** — every connection past the limit is the
   `FATAL:` above.

An inner cap larger than the outer one is the shape to look for, and it is worth
checking before raising anything.

## There is no pooler, and two settings are forbidden

There is no PgBouncer between the fleet and the cluster. That is a decision, and
the short version of the argument is that PgBouncer's own documentation
describes the remedy for its worst failure mode as a manual `RECONNECT` on its
admin console after a DDL migration — which would be a manual operator step
after every schema change in every service.

**What that means for your config is the part that will reach you.** Two
settings exist purely to survive a pooler, and `kit`'s gate reads a list of nine
**tokens** covering them and fails if any appears in a generated database config.
The check is per language, over the file kit generates, and it is one line of a
`kit` gate run:

```
PASS templates/database/*  (the contract, in the generated output, per language)
              contract: 6 language(s) x (3 required + 5 pool tokens + 9 forbidden) — all satisfied
```

| Setting | Driver | What it does |
| --- | --- | --- |
| `prepare: :unnamed` | Postgrex (Elixir) | disables named prepared statements |
| `default_query_exec_mode=simple_protocol` | pgx (Go) | the same thing, spelled differently |

Both make **every execution re-parse and re-plan**. A service carrying one is
**measurably slower and looks completely fine**, and the only way anyone would
notice is to look for the flag — which is why it is a list in one file that a
check reads, rather than a paragraph asking you to remember.

The other tokens on that list — `track_extra_parameters`, `server_reset_query`,
`max_prepared_statements` — are there for a different reason: those are
`pgbouncer.ini` keywords, so a config carrying one has, in effect, configured a
pooler the fleet does not have.

**The settings you *do* carry** are named in the same file, and one of them is
not optional. `application_name` is the only thing that makes a query
attributable, and on a shared cluster the whole fleet's queries appear in one
`pg_stat_activity`:

```sh
psql -h localhost -U cafaye -d cafaye_platform -X -c "
SELECT application_name, usename, datname, state, left(query, 40) AS query
  FROM pg_stat_activity WHERE state = 'active' ORDER BY application_name;"
```

Without it the row says only which role is running, and every service in the
fleet looks the same. It is the service's own name, which is also its database
name and its role name.

## Extensions are a cluster decision

`vector` — pgvector, on the image the cluster is built from — is created **by the
admin role, into every service database**, at init. A service role cannot create
it, and the refusal is Postgres's own:

```sh
psql -d parking -U muse -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

```
ERROR:  permission denied to create extension "vector"
HINT:  Must be superuser to create this extension.
```

pgvector's control file is not marked `trusted`, so this is pgvector's own
classification rather than something the packaging drops. **A service that needs
an extension the cluster does not have is an operator action and a volume
recreation**, not a self-service step. That is the trade: the binaries are in the
image, so the extension is *available* to every service whether or not anybody
creates it, and the list decides only who pays the disk cost.

To see what a database actually has:

```sh
psql -d courier -X -c '\dx'
```

```
                                      List of installed extensions
  Name   | Version | Default version |   Schema   |                     Description
---------+---------+-----------------+------------+------------------------------------------------------
 plpgsql | 1.0     | 1.0             | pg_catalog | PL/pgSQL procedural language
 vector  | 0.8.6   | 0.8.6           | public     | vector data type and ivfflat and hnsw access methods
(2 rows)
```

## The two timeouts, and when each one fires

Both are set per role, so they are a backstop for a service that omitted them in
its own config rather than the only line of defence. They are the reason a
shared cluster is survivable at all.

| Setting | Default | What it stops |
| --- | --- | --- |
| `statement_timeout` | 15s | one service's runaway query occupying shared resources until it finishes |
| `idle_in_transaction_session_timeout` | 30s | one forgotten `BEGIN` holding a snapshot open and blocking `VACUUM` cluster-wide |

Both are enforced by the cluster, so a service whose own config sets neither is
still bounded. Measured, on a service role whose connection config sets no
`statement_timeout` of its own — the cluster's per-role backstop is what fired:

```sh
psql -d billing -U billing -c 'select pg_sleep(20);'
```

```
ERROR:  canceling statement due to statement timeout
```

and in the Postgres log, for the second one, when a session is left sitting in an
open transaction:

```
FATAL:  terminating connection due to idle-in-transaction timeout
```

**The second one is the shared-cluster killer** and it is the least visible of
the two. One service's forgotten `BEGIN` holds a snapshot open, `VACUUM` cannot
reclaim space anywhere on the box, and every table in every database grows until
the disk fills. On one database per machine that is one service's problem; on one
cluster it is every service's. If disk is growing and nothing is wrong, look for
a session in `idle in transaction`:

```sh
psql -h localhost -U cafaye -d cafaye_platform -X -c "
SELECT pid, usename, datname, state, now() - state_change AS for
  FROM pg_stat_activity
 WHERE state = 'idle in transaction' ORDER BY state_change;"
```

## What is not proven, and what is left to you

Read this section before you rely on the boundary.

- **The cluster holds a database, a role and a role limit per service. It does
  not hold the per-service schema.** `REVOKE CREATE ON SCHEMA public FROM
  PUBLIC` is applied and stated explicitly, but it is already the PostgreSQL 15+
  default — the floor, not the mechanism. The mechanism is the `REVOKE` above.
- **A backup does not carry the boundary.** The dump is
  `pg_dump --format=custom --no-owner --no-privileges` of a single database, so
  it carries no `CREATE ROLE`, no ownership and no `CONNECT` grant. **Restoring
  into a fresh database on this cluster gives you a database with Postgres's
  default, which is open to every role** — run the sweep query after any restore
  that creates a database. [Backup and
  restore](/runbooks/backup-and-restore/) says what a restore replaces and what
  it does not.
- **A restore drill creates a scratch database on the cluster** and it gets
  Postgres's default for the same reason. `bin/drill` drops it, including after
  a failure, but a drill interrupted hard enough to leave it is a hole the sweep
  query will find.
- **Isolation is by privilege, never by secret.** Every development role takes
  the same password, because it runs on your machine and a shared development
  password is the point — which is also why the boundary above can be
  demonstrated while knowing every password in the cluster. In production the
  roles carry distinct passwords from the deployment secret store, and nothing
  about the boundary changes.
- **`kit`'s own proof is a test, not a command you run against your stack.**
  `bash tests/isolation_test.sh` in a `kit` checkout builds two service
  databases on a real cluster, asserts that each role is refused at the other's
  door, and then builds a **control** cluster of the same shape *without* the
  `REVOKE` and requires the control to let the role in. That control is what
  makes the refusal mean something: a check asserting only "A cannot read B's
  rows" would also pass on a cluster with no isolation at all, because the table
  grants refuse the `SELECT` anyway. **There is no `bin/dev` subcommand that
  proves isolation on a running cluster** — the sweep query at the top of this
  page is what you run yourself.
- **Isolation across the fleet is not uniform yet, and the sweep query will not
  tell you so.** It answers for one cluster. `identity`, `billing` and `courier`
  are on that cluster; `darkroom` and `muse` each still run a Postgres that is
  their own, where their isolation is a container rather than a privilege, and
  `kit`'s fleet gate names both. **A green sweep on the shared cluster and a
  cross-service read on `darkroom`'s own database are not contradictions** — they
  are two different topologies, and the second one is the one `kit` is trying to
  retire.

## See also

- [Topology](/architecture/topology/) — the operator's table, and the drift
  audit.
- [A service cannot connect to its database](/troubleshooting/#a-service-cannot-connect-to-its-database)
  — the symptom-keyed entry, and the three reasons that are now possible.
- [A service is down](/runbooks/service-down/) — which component, before you
  touch the database.
- [Backup and restore](/runbooks/backup-and-restore/) — what a restore replaces
  on a shared cluster, and what it does not.
