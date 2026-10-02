---
title: Pricing
description: What a cafaye unit costs, what is free, and which of the three paid products exists — with no invented numbers, and the open questions listed.
---

:::caution[Status: nothing is purchasable today, and there is no price on this page]
**There is no managed cafaye, no checkout, no account, and no published
price.** The three paid products — managed hosting, upgrades, support — are
described below in the shape each will take, and every row says which of them
exists. As of **2026-10-01**, none of the three is in operation.

This page exists because a stranger deciding whether to buy a unit had no way to
find out what it costs, and a page that read like a price list without one would
be worse than no page. The numbers we have not decided are
[listed](#the-numbers-we-have-not-decided) rather than guessed.
:::

The commercial model, in four sentences, and it is not complicated:

- **The code is free.** Every repository is public, every command is
  installable, and nothing is gated behind a purchase. There is no paid tier of
  the software, no source drop, and no feature that arrives with a receipt.
- **What we sell is hosting, upgrades, and support.** The engineering, not the
  licence.
- **You buy one unit, not the fleet.** The platform, `identity`, or `courier` —
  take the one you need. Nobody is made to take all three to get one.
- **`parlor`, the app shell, is free** and always will be.

## What "the code is free" means concretely

Not a trial that expires and not a tier that unlocks: the grant does not depend
on buying anything from us. Four specific consequences, all checkable:

| Consequence | Where to check |
| --- | --- |
| `go install github.com/cafaye/caf/cmd/caf@latest` — no account, no key, no telemetry handshake | [Getting started](/getting-started/#step-2--install-caf) |
| `git clone` of any service, then `docker build` — no licence key, no activation, no build-time callback | [Getting started](/getting-started/#step-6--deploy-to-your-own-infrastructure) |
| No licence check, no update check, no analytics, and no request to a cafaye-operated endpoint in any service | [Hosted pilot](/pilot/#what-leaves-your-infrastructure) |
| No service stores or expects anything about who is running it | same as above |

The licensing position — what the grant actually says, and the part of it that
is not finished — is [its own page](/licensing/), because "free" and "licensed"
are two different claims and conflating them is how a company ends up telling a
buyer something its repositories do not.

## The three units

A unit is a thing you can buy on its own. Each is a set of public repositories
plus the paid work around them.

| Unit | Repositories | What it is | What you would run |
| --- | --- | --- | --- |
| **Platform** | [`caf`](https://github.com/cafaye/caf), [`kit`](https://github.com/cafaye/kit) | the CLI and the shared CI: one binary that renders and runs your local stack, one workflow every service's gate runs in | `caf` on your machine; your own CI |
| **identity** | [`identity`](https://github.com/cafaye/identity) | users, sessions, accounts and tenancy, roles, invitations, the OIDC provider, TOTP MFA | one Go container, one Postgres, optionally Redis |
| **courier** | [`courier`](https://github.com/cafaye/courier) | transactional email, notification preferences, and **every outbound webhook**, signed and retried | one Elixir container, one Postgres, one database-backed outbox worker |

Both service units are [documented in their own words](/services/identity/ and
[courier](/services/courier/)), including what is not built. Read the status line
before you rely on either — the tables here are a summary and the service pages
are the claim.

`core` is not a unit and is not separately sold. It publishes the schemas that
`caf` and `kit` read — the manifest format, the event catalog, the telemetry
contract — and it is public like everything else. The reasoning is worth stating
plainly: a contract that is not open cannot be read by the person deciding
whether to depend on it.

## What each level would include

The three paid products, across the three units. **The `today` column is the
whole honesty of this page** — it is a measured statement about the code, not an
estimate.

### Managed hosting

| Unit | What it would be | Today |
| --- | --- | --- |
| Platform | a cafaye-operated control plane, and `caf deploy` that has somewhere to deploy to | **Does not exist** — and the reason is the first half, not the second. `caf deploy` is implemented: it deploys a service with Kamal, building the image, pushing it and rolling it out behind `kamal-proxy`. What does not exist is a cafaye-operated remote for it to authenticate against, so today it deploys to infrastructure you already pay for. |
| identity | your deployment, our pager | **Does not exist.** Today "hosted" means you run it in your own account and we help you get it running — which is consulting, not a product. |
| courier | your deployment, our pager, and a configured email provider | **Does not exist.** Separately, no email provider adapter is configured in any cafaye checkout, so nothing is delivered until you set one. |

**What we would be taking on:** running your containers, your Postgres, your
bucket, your TLS terminator and your keys, with an uptime target and somebody
paged when it breaks. **What we would not be taking on:** holding your customer
data's keys. Nothing in the architecture requires a cafaye-operated component in
the stack, and we would rather not add one.

### Upgrades

| Unit | What it would be | Today |
| --- | --- | --- |
| Platform | moving you onto a new `caf` and a new kit contract set, and telling you what broke | **Undecidable today, and the reason is worth knowing:** `caf` has **no tagged release** — `go install @latest` resolves to a pseudo-version built from `master`. There is no version to upgrade *to*. |
| identity | applying new migrations, rolling the image, verifying | The migrations are written and the deploy order is documented ([runbook](/runbooks/backup-and-restore/) and [getting started](/getting-started/#migrations-are-a-step-you-run-not-something-that-runs-itself)), but no service in the fleet has a release tag to upgrade between. |
| courier | as above | same |

This is the product we are least able to sell, and the reason is a single fact:
**only one repository in the fleet has a version tag, and it is `core`, not a
service.** Everything else is `master`. Upgrades as a purchasable thing requires
release tags first, and those are our work, not yours.

### Support

| Unit | What it would be | Today |
| --- | --- | --- |
| Platform | a named human and a response window for `caf`, kit, and the contract set | Available as a design-partner arrangement with the terms agreed **in writing** before the work starts. There is no published support address, no status page, no uptime record, and no SLA anywhere on the org. |
| identity | the same, for a service holding your users' credentials | as above |
| courier | the same, for the service that talks to your customers | as above |

What a support arrangement actually gets you, stated so it is not a promise
made of adjectives: a named person and an agreed response window, changes landed
in the repository with the commit rather than a ticket number, and a seat at the
design decisions that affect you while they are still open. The full list is in
[what a design partner gets](/pilot/#what-you-get-that-a-public-user-does-not).

**Two limits you should know before you buy any of it.** There is no support
address published on the org — the per-repository `owner.contact` addresses are
the only ones that exist, thirteen repositories declare one, and the two that do
not are `kit` and `cafaye-py` because they have no `cafaye.yml` at all. And no
SLA exists: uptime, response and remedy are all things we would have to agree in
a contract before the first day of work, because publishing them here would be a
commitment nobody has priced.

## `parlor` is free

The app shell — signup, login, accounts, billing screens — is free and always
will be. It is not a unit, not an upgrade path to something paid, and not a
lead-generation front for the other two. It is a template, and its own status
line says what is missing: no admin surface, no end-to-end suite, and a
`cafaye.yml` that does not validate. [Its page](/services/parlor/) is honest
about all three.

## The services that are not units

`billing`, `darkroom`, `guard`, and `muse` are **not packaged as units today**.
That is a packaging decision rather than a judgement on them, and it has a
consequence worth stating: a buyer who wants one of them today has nothing to
buy, and the honest answer is to ask us what it would take to package it. There
is no fourth unit on this page, because inventing one would be a price list with
a fiction in it.

If you want `guard` in front of your stack, read its page first: it
[authenticates and forwards nothing](/services/guard/), and its browser sessions
live in one process's memory.

## The numbers we have not decided

Every one of these is a question for us rather than an omission from this page.
A guessed number is worse than a blank one, so they are blank.

1. **Is there a price at all, or is every engagement scoped?** We have not
   decided. Day rate, monthly, or per-request is a real fork.
2. **What does managed hosting cost, and what does it promise?** No price, no
   uptime target, no support hours, no SLA, and no data-processing terms.
3. **What is an "upgrade" worth when the thing being upgraded has no release
   tag?** Until `identity` and `courier` are tagged, the product is not
   definable, let alone priceable.
4. **How do the three units price relative to each other?** A buyer who wants
   `identity` should not have to buy the platform to get it, and the relative
   weights are unset.
5. **Is a design-partner engagement a discount, a credit against a later
   purchase, or simply a different kind of arrangement?** Undecided, and it
   changes what a pilot is worth to us.
6. **What are the payment and invoicing terms?** No processor is chosen, no
   entity is named on this page, and there is no checkout — by design, until the
   terms exist.
7. **What happens to a unit's support if the unit is self-hosted and you change
   the code?** Scope of responsibility is unset, and pretending otherwise would
   be a warranty we have not written.

**To get an answer, ask.** The channels that exist today are the
[repositories](https://github.com/cafaye) — every service's issues and history
— and the per-repository `owner.contact` address in its `cafaye.yml`:
`caf@cafaye.com` for the CLI, `identity@cafaye.com`, `courier@cafaye.com`,
`docs@cafaye.com`. A number you get by email is a number you can hold us to;
one invented for a landing page is not.

## What is not ready yet

Stated here rather than left for you to infer from the tables:

- **No managed hosting product in operation.** There is no platform of ours to
  point at.
- **No release tags on any service.** `go install @latest` gives you `master`,
  and `core` is the only repository with a version tag.
- **Three of `caf`'s twelve commands are stubs: `caf gen`, `caf init` and
  `caf new`.** They parse their flags and return `not implemented in v0`. The
  other nine — `backup`, `contract`, `deploy`, `dev`, `doctor`, `env`, `mcp`,
  `reclaim`, `version` — work, **including `caf deploy`**, which builds, pushes
  and rolls out with Kamal. It deploys to infrastructure you already pay for;
  what it does not have is a cafaye-operated remote.
- **`identity`'s password reset and email verification are built but unconfigured
  by default.** Both are served, published in `identity`'s OpenAPI document, and
  implemented end to end by `site` — but the recovery surface is mounted only
  with a mailer behind it. Until `COURIER_BASE_URL`, `COURIER_TOKEN` and
  `PASSWORD_RESET_LINK_TEMPLATE` are set, `POST /v1/password-resets` answers
  **503**, not 404. **Budget for that configuration, and for a support channel
  behind it.**
- **`courier` has no email provider adapter configured,** so nothing is
  delivered out of the box.
- **Nothing publishes events off the outbox.** An event is a row, not a
  notification, so no service reacts to another automatically.

The full, commit-pinned list with what each one costs you in practice is
[What is not production-ready yet](/pilot/#what-is-not-production-ready-yet),
and it is the page to read before you commit to anything on this one.

## See also

- [Licensing](/licensing/) — what MIT means for a buyer, and the part of the
  grant that is not written down yet.
- [Security and trust](/security/) — how credentials and secrets are handled,
  with every claim pointing at the code that makes it.
- [Hosted pilot onboarding](/pilot/) — the path from nothing to a running
  deployment, and what a design-partner arrangement asks back.
- [Getting started](/getting-started/) — install the CLI and run a service
  against local Postgres.
- [Services](/services/) — one page per service, each stating what is built and
  what is not.
