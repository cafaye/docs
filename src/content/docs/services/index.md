---
title: Services
description: One page per cafaye service — what it owns, which language it is written in, and what exists today.
---

cafaye is an organization, not a single repository. Each service below lives in
its own repo, is versioned and installable on its own, and declares its
contract surface in a `cafaye.yml` manifest — so you can take the one you need
rather than adopting the whole platform.

**Read the status line on each page before you rely on it.** cafaye is in early
development; a page that says a command does not ship yet is telling you the
truth, not hedging.

| Service | Owns | Language | Status |
| --- | --- | --- | --- |
| [identity](/services/identity/) | Auth, sessions, accounts, tenancy | Go | v0 skeleton |
| [billing](/services/billing/) | Plans, subscriptions, credits, metering | Ruby | v0 — customers & plans |
| [courier](/services/courier/) | Email, push, every outbound webhook | Elixir | v0 scaffold |
| [darkroom](/services/darkroom/) | Media uploads, variants, S3 | Rust | Not started |
| [muse](/services/muse/) | LLM routing, vault, token metering | Python | v0 scaffold |
| [guard](/services/guard/) | Public gateway, JWT verify, rate limits | TypeScript | v0 — auth only |
| [parlor](/services/parlor/) | App shell template + admin | Next.js | Phase 2, in progress |

## Why one language per service?

Because services have different jobs. `identity` holds the keys to everything,
and wants Go's discipline and a static binary. `courier` fans out to thousands
of providers concurrently, which is the BEAM. `darkroom` pushes pixels and does
not want GC pauses. `billing` is pure domain modelling, which is Ruby's home
turf. `muse` talks to models, and Python's ecosystem is unmatched there.
`parlor` is the web, so it is TypeScript.

Polyglot by design, connected by typed contracts, never by shared code. Two
services that both need a date format library each use their own language's —
there is no shared internal package to version, which is what keeps a service
upgradable on its own schedule.