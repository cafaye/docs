---
title: identity
description: Auth, sessions, MFA, OAuth, accounts and tenancy, and the OIDC provider — cafaye's security boundary.
---

`identity` is the service that knows who someone is. It owns users and sessions,
multi-factor authentication, OAuth sign-in, accounts and tenancy, and the OIDC
provider — which means every other service (`billing`, `courier`, `guard`,
`parlor`) asks this one who is calling and what they may do. It is written in
**Go** because it holds the keys to everything and wants a static binary and a
compiler's worth of discipline around them.

:::caution[Status: v0 skeleton]
This is scaffolding on purpose, not a working auth service. What exists today is
the shape every later packet builds on: configuration validation, liveness and
readiness probes, a Postgres pool, the migration convention, and a container
image. **There is no authentication logic in it yet** — no sessions, no password
auth, no MFA, no OAuth, no accounts or roles, no OIDC endpoint, and no admin API.
Nothing is stubbed to look finished.
:::

Because this is the platform's security boundary, `identity` is built to a
stricter standard than the rest: an authorization matrix test generated from a
route table asserting every endpoint against every role and against an anonymous
caller, and a security checklist reviewed before the phase closes. Sessions and
password auth, email verification and reset, OAuth, accounts and roles,
invitations, OIDC, MFA and recovery codes, scoped API tokens, and the admin API
are all later packets against that skeleton.

Its contract is the widest in the platform — it publishes the largest event
catalog — and it is the one service every other service depends on. Read
[Contracts](/contracts/) for how those events and its OpenAPI surface are
declared.

- **Repository:** [github.com/cafaye/identity](https://github.com/cafaye/identity)
- **Language:** Go
- **Namespace / event source:** `identity`