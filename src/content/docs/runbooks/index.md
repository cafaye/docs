---
title: Runbooks
description: The procedures that keep a cafaye deployment alive — provisioning, backup, rotation, outages, and billing webhooks.
---

These are the runbooks. `PLAN.md` §8 names *"support burden once pilots land"* as
a risk, and the control is that the procedure is written down before somebody
needs it at 2am with a customer waiting.

Each one is a procedure, not an explanation: preconditions, exact commands, the
verification step that proves it worked, and — importantly — **what not to do**.
A runbook that does not say what not to do gets read as a menu.

## The five

| Runbook | Use it when |
| --- | --- |
| [Tenant provisioning](/runbooks/tenant-provisioning/) | A new customer's account has to exist, end to end, with somebody in it who can sign in. |
| [Backup and restore](/runbooks/backup-and-restore/) | You need a database you have actually restored, not a database you have actually backed up. |
| [Rotating secrets](/runbooks/secret-rotation/) | A signing key, a Stripe secret, a provider credential, or a bucket credential has to change without downtime. |
| [A service is down](/runbooks/service-down/) | Something is answering 5xx, 503, or nothing at all, and you do not yet know what. |
| [Billing webhooks failing](/runbooks/billing-webhooks/) | Stripe is delivering and billing is not acting, or billing is answering 4xx/5xx. |

A sixth page sits with these and is the one to read **before** you trust a green
badge anywhere in the fleet:

- **[Running the gates](/running-the-gates/)** — the exact command for every
  cafaye repository, and the tiers that do **not** run by default. A gate that
  skips is green and has proved less than it appears to, and most repositories
  have no CI at all.

## What every one of these assumes

**You are running the services yourself.** There is no hosted cafaye platform
today, so "the environment" means containers you built from each repository's
Dockerfile on infrastructure you control.

**The deployment mechanism is `kamal`, and `kit` ships its configuration.** Two
configuration files — `config/deploy.yml` and `config/kamal-backup.yml` — and one
wrapper, `bin/drill`, copied out of `kit`'s `templates/kamal/`. **No service in
the fleet has adopted them yet**, so a runbook that says "roll the service" means
whatever your own deployment does; [Getting started](/getting-started/) has the
per-service build and run steps, and [backup and
restore](/runbooks/backup-and-restore/) is written against the mechanism in full.

**Migrations are a deploy step, not a boot step.** No service migrates on boot.
Run them as a job before the new image rolls out, and fail the deploy on a
non-zero exit. A half-applied migration is worse than one that did not run.
`bin/dev up` runs your repository's migration command for you locally; nothing
does it in production.

**The services are stateless; the databases are not.** Every image is a
multi-stage, non-root build with no volume mounted, so a pod restart loses
nothing. Every piece of durable state is in a Postgres database, and Postgres is
the only thing in this platform that a backup runbook has to care about.
**Object storage is the second thing and it now exists** — `darkroom` hands out
presigned writes into a bucket you choose (S3 or Cloudflare R2), and the bucket is
**not** covered by the database dump. A restored database whose objects are gone
has assets pointing at nothing.

**A green badge is only worth what it ran.** `kit`'s reusable workflow is callable
and eight repositories now call it, but in most of the fleet the interesting
tests sit in a second tier that does not run by default. "The gate is green"
often means somebody ran the suite by hand, that day. [Running the
gates](/running-the-gates/) has the commands, the tiers that skip, and the one
repository that has solved it.

## Two facts that shape every runbook here

**Probes never leak their failures.** Liveness answers whenever the process can
dispatch, so a database outage does not restart the container. Readiness answers
503 while the service cannot do work. The underlying error — a host, a port, a
rejected password — is logged and never returned, because an unauthenticated
`GET /readyz` must not be a way to discover that the database is at `10.0.0.5`.
**If you are reading a bare 503, the reason is in the service's logs.**

**No service publishes events to a bus.** `identity`, `billing`, `muse`,
`courier` and `darkroom` all write `outbox_events` correctly, in the same
transaction as the domain change, and **none of them starts a publisher loop.**
`identity`'s only `Publisher` implementation is a deliberate no-op, because
starting it would mark every event published and drain the outbox into nowhere.
So an event in this platform today is a row, not a notification. Any runbook step
that would "trigger a downstream reaction" is marked, and it does not exist —
except that `courier`'s outbound webhooks **are** real, and they are HTTP
requests `courier` makes itself, not events on a bus.

## Conventions used here

- Commands are bounded with `timeout N` where a hang is possible, and a long
  network call is never left unwatched.
- `$SERVICE_DB` and similar are set once at the top of each runbook from the
  service's real `DATABASE_URL`, so the commands are copy-pasteable and there is
  exactly one place a credential appears.
- Verification is always a separate step from the action. Applying a migration
  is not evidence that it worked; querying the result is.
- Anything destructive says so in the sentence before the command, not in a
  footnote.
