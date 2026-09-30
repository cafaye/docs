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

:::caution[Status: v0 — accounts and tenancy landed]
Password auth, sessions with lockout, and **accounts, memberships, roles, and
invitations are built and tested**, with an authorization matrix suite generated
from the route table. Migration `00005` onward creates `accounts`,
`account_users`, and `account_invitations`; `POST /v1/accounts` and the whole
`/v1/invitations/accept` flow are registered and working.

**Not built:** email verification and password reset, OAuth via goth, the OIDC
provider, MFA (TOTP and recovery codes), scoped API tokens, the admin API, and
`identity.session.revoked` — `DELETE /v1/session` does not emit it yet. The
OIDC library is present in `internal/oauth` (cipher and store) but there is no
`/.well-known` endpoint, so `guard` has no key set to verify against until that
packet lands.

Two things to know before you rely on it. The `/v1/accounts` routes are
**registered in code but not yet in `openapi/v1.yaml`**, which still covers only
`/v1/users`, `/v1/session`, `/v1/me`, and the two probes. And **no service
starts an outbox publisher loop** — events are recorded in `outbox_events` and
delivered to nobody. See [tenant
provisioning](/runbooks/tenant-provisioning/) for the working end-to-end flow.
:::

Because this is the platform's security boundary, `identity` is built to a
stricter standard than the rest: an authorization matrix test generated from a
route table asserting every endpoint against every role and against an anonymous
caller, and a security checklist reviewed before the phase closes. Email
verification and reset, OAuth, the OIDC provider, MFA and recovery codes, scoped
API tokens, and the admin API are later packets against what is here.

Its contract is the widest in the platform — it publishes the largest event
catalog — and it is the one service every other service depends on. Read
[Contracts](/contracts/) for how those events and its OpenAPI surface are
declared, and [Topology](/architecture/topology/) for the route table, the role
hierarchy, and the three environment variables it reads.

- **Repository:** [github.com/cafaye/identity](https://github.com/cafaye/identity)
- **Language:** Go
- **Namespace / event source:** `identity`