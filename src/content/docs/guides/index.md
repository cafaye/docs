---
title: Guides
description: Task-oriented walkthroughs for cafaye. Placeholder — nothing published yet.
---

This section is a placeholder. Nothing is published here yet.

Guides are the task-oriented pages: "add a subscription and meter it",
"authenticate a request through `guard`", "generate an SDK from a contract".
They assume you have read [Getting started](/getting-started/) and know what you
are building, and they get to the point fast.

:::note[Nothing here yet]
A guide will land when a task is actually walkable end to end — which, in early
development, means after the services it depends on exist. Writing a guide
against commands that do not run yet produces the kind of confident, wrong
documentation this site is trying to avoid.
:::

## What is walkable today, and where it lives

Those pages have not been written as guides because they are procedures rather
than walkthroughs, and a procedure with a wrong step in it is worse than no
guide at all. They are here instead, and every command in them was run against
the real `caf` binary and the real service repositories:

- [Getting started](/getting-started/) — install `caf`, validate a manifest,
  render and run a local stack, build its image. The whole path, with the five
  unbuilt commands marked.
- [Upgrading](/upgrading/) — if you already run a deployment. What breaks in the
  contracts and the order to fix it in.
- [Tenant provisioning](/runbooks/tenant-provisioning/) — create an account,
  invite somebody, promote them, and verify it. Quoted from a live session.
- [Backup and restore](/runbooks/backup-and-restore/) — what the scheduled
  `pg_dump` covers, the bucket it will not save for you, the data you lose when
  a database is destroyed, and the drill that proves a restore works.
- [Rotating secrets](/runbooks/secret-rotation/) — Stripe, provider
  credentials, database passwords, object-storage keys, and the one that cannot
  be rotated.
- [A service is down](/runbooks/service-down/) — which service, which kind of
  down, and what not to do.
- [Billing webhooks failing](/runbooks/billing-webhooks/) — inspect, replay,
  recover, and why a replay is safe.
- [Running the gates](/running-the-gates/) — the exact command for every
  repository, and the tiers that skip by default. Read this one before you
  believe a green badge.

## In the meantime

- [Contracts](/contracts/) — how the services find each other. The one thing
  worth understanding before anything else.
- [Architecture](/architecture/) — what each service owns and why.
- [Topology](/architecture/topology/) — ports, probes, environment variables,
  and the cross-repo drift audit.
- [Observability](/observability/) — the telemetry contract, and the honest
  answer to "is the stack running".
- [Services](/services/) — one page per service, each stating plainly what is
  built and what is not.
- [the org](https://github.com/cafaye) — for what is landing right now.
