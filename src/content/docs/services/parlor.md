---
title: parlor
description: The app shell — a production-ready frontend template plus the admin surface every cafaye product inherits.
---

`parlor` is the front door of every product built on cafaye: a Next.js app shell —
signup, login, accounts and tenancy, team and invitation management, and the
billing screens — plus the admin surface they all inherit. It is **Next.js**,
because it is the web and nothing else needs to be.

:::caution[Status: in progress — accounts, invitations and billing screens]
Eight routes exist today: a landing directory at `/`, `/register` against
`POST /v1/users`, `/login` against `POST /v1/session`, `/accounts` and
`/accounts/[accountId]` for the tenancy surface, `/invitations/[token]` to redeem
an invitation, and `/billing/plans` and `/billing/customers` against billing's
API. The shell (header, sign-out when authed), a typed transport-injected
identity client, a typed billing client, React Query session state, an
injectable `localStorage` token store, health surfaces, hand-rolled UI primitives
and a vitest rig are all in place.

**Not built:** the admin surface, product screens, settings, and the Playwright
end-to-end suite. This is not a finished template to clone today — it is a
working shell that is still growing.

**Its `cafaye.yml` is still the pre-`core` `apiVersion: cafaye/v0-draft` shape
with no `name` at the top level, and it does not validate.** It is the only
repository in the fleet where `caf contract lint` fails. See the drift audit in
[Topology](/architecture/topology/#cross-repo-drift-audit).
:::

## It is a template, not a platform dependency

That is the design decision to understand before using it. You clone it, you read
all of it, you change what you need and ship your fork: no license key, no
feature gate, no call home, and no vendor who can raise your prices or pull the
rug later. Anything cafaye adds to the shell arrives as code in your repository,
not as a runtime dependency, and upstream improvements come back as a merge
rather than a migration.

**The test of whether that is real:** if cafaye disappeared tomorrow, a
`parlor`-based product would keep shipping.

## The tenancy surface is gated by role, transcribed from identity

`src/lib/roles.ts` is the capability matrix, transcribed from `identity`'s own
authorization — so the UI hides what the API would refuse, and the API is still
the authority. Each account call declares the minimum role its route needs:

| Call | Minimum role |
| --- | --- |
| `listAccounts(token)` | any session |
| read one account, list members | `member` |
| create a tenant | any session |
| rename, invite, remove a member | `admin` |
| change a role, delete the account | `owner` |

The invitation route **does not accept on load** — it takes a deliberate click,
because an invitation token redeemed by a prefetch or a crawler is an account
created for whoever the link was forwarded to.

## Money is integers here too

`src/lib/money.ts` takes integer minor units in and gives a price out, and the
billing client has its own error type rather than borrowing identity's. The rule
is the platform's rule and the shell follows it, so a fork does not start with a
Float.

## Session handling is settled in the repository, not the template

Because the browser reaches `identity` cross-origin, session handling is a
deliberate decision here: a BFF route owns the cookie before it can be one. The
token is in an **injectable `localStorage` store** rather than a hard-coded
access, which is what makes the test rig possible and a future cookie-based BFF a
change rather than a rewrite.

The Playwright suite (signup, login, MFA, invites, checkout) is born here and is
**not written yet**.

- **Repository:** [github.com/cafaye/parlor](https://github.com/cafaye/parlor)
- **Language:** Next.js / TypeScript
- **Local port:** 3000 · `bun run dev`
- **Health:** `GET /healthz` → `{"status":"ok"}` · `GET /readyz` →
  `{"status":"ok","deps":"none"}`, where `deps` is a reserved placeholder
