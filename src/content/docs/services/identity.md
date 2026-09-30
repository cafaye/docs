---
title: identity
description: Auth, sessions, accounts and tenancy, and the OIDC provider — cafaye's security boundary.
---

`identity` is the service that knows who someone is. It owns users and sessions,
accounts and tenancy, roles and invitations, and the **OIDC provider** — which
means every other service (`billing`, `courier`, `guard`, `parlor`, `darkroom`)
asks this one who is calling and what they may do. It is written in **Go**
because it holds the keys to everything and wants a static binary and a
compiler's worth of discipline around them.

:::caution[Status: v0 — accounts, tenancy, the OIDC provider, and MFA are built]
Password auth with lockout, **accounts, memberships, roles and invitations**, the
**OIDC provider**, and **MFA** are built and tested. The OIDC provider means
discovery, client registration, the authorization-code flow with PKCE, token
issuance, and **`/.well-known/jwks.json`** — so `guard` has a real key set to
verify against. There are two OpenAPI documents: `openapi/v1.yaml` for the `/v1`
surface and `openid/openid.yaml` for the OIDC one.

**MFA is TOTP with recovery codes, and it is on the `/v1` surface**: enrollment,
confirmation, the login challenge at `POST /v1/session/mfa`, recovery-code
reissue, and `DELETE /v1/mfa` to turn it off. Confirming a factor **revokes every
session the user holds**. `MFA_ENCRYPTION_KEY` is base64url, exactly 32 bytes,
seals the TOTP secret at rest and is **never generated** — unset means the
management routes are **absent** rather than present-and-broken, and a wrong
length is a startup failure.

**Not built:** email verification and password reset, OAuth sign-in via goth,
scoped API tokens, the admin API, and key rotation. No self-service password
recovery — a user who forgets a password today has no path back in.

Inside the OIDC provider specifically not built: refresh tokens (access tokens
live fifteen minutes and cannot be renewed), the implicit flow, client
credentials, dynamic client registration, introspection, the revocation endpoint,
end-session, the device flow, and a consent screen. Each is **absent from the
discovery document** rather than a stub that looks finished.

**No service starts an outbox publisher loop.** `identity` writes `outbox_events`
in the same transaction as its domain change, and its only `Publisher`
implementation is a deliberate no-op — starting it would mark every event
published and drain the outbox into nowhere. See [tenant
provisioning](/runbooks/tenant-provisioning/) for the working end-to-end flow.
:::

## Because this is the platform's security boundary, the bar is higher

An authorization matrix test generated from a route table asserts every endpoint
against every role and against an anonymous caller, and `TestEveryRouteIsInTheMatrix`
fails if a route is added without a row. A new route goes into
`registerTenancyRoutes` **and** the matrix, in the same commit.

Two properties that are load-bearing and will not be relaxed:

- **Redirect URIs are matched exactly, always.** Nothing implements
  `op.HasRedirectGlobs`, and the registration validator refuses a wildcard, so a
  `redirect_uri` can only ever be matched by equality. A prefix comparison turns
  this service into an **open redirector** for every product registered on it.
- **One signing key, and it is configured.** `OIDC_SIGNING_KEY` is read from the
  environment and **never generated**. A key generated at boot publishes a
  document no caching verifier has seen, and two processes behind a load balancer
  would each publish a different one. The library's token-encryption key is
  **derived** from it with a domain-separated SHA-256 rather than configured
  separately — one secret to rotate, and it is genuinely used, because the
  userinfo handler decrypts an access token before it verifies one.

## The OIDC protocol is delegated, not reimplemented

`zitadel/oidc` owns the OAuth 2.0 and OIDC state machines. `internal/oidc`
supplies the two things a library cannot have: a storage implementation over this
service's own tables, and a login UI bound to this service's own sessions. PKCE
verification, redirect-URI matching, the code response and the id_token are the
library's job, and where this service disagrees with its defaults the
disagreement is a **refusal with a reason at its own definition** — `requireS256`,
the absence of `op.HasRedirectGlobs`, the narrowing in the discovery document —
rather than a branch inside a handler.

`go-jose/v4` is a **forced** dependency, not a chosen one: the library's storage
interface cannot be implemented without it.

## Client management is owner-gated, and that is not an oversight

A product cannot register itself. Client management is owner-gated on an account,
reusing the tenancy role check, because `identity` has no platform-admin role
yet — the admin API is a later packet, and a rule this service cannot express
would be a rule with a bypass in it.

## Tenancy: the shape, and the rule that protects an account

Registration creates **two** things in one transaction: a `users` row and a
**personal account** for that user, plus an owner membership. A design partner's
tenant is the *second* account — a deliberate, non-personal one with a slug
somebody can put in a hostname. Both existing is normal.

Roles are `owner`, `admin`, `member`: a PostgreSQL enum, ordered, and the ordering
is what the minimum-role check compares.

| Operation | Minimum role |
| --- | --- |
| Read the account, list members | `member` |
| Rename, invite, remove a member | `admin` |
| **Change a role, delete the account** | `owner` |

**A non-member gets `404`, never `403`.** A `403` would tell any authenticated
caller that an account id they guessed is real, which is a free tenant-enumeration
oracle on the table whose ids are the only thing between one customer and
another. So the two denials are kept apart: `404` when the resource is not yours
to know about, `403` when it is and you lack the permission. **A `404` on an
account you believe exists is usually a membership problem, not a missing
account.**

**The last owner is never removed.** An owner demoting themselves while they are
the only owner gets a `422` naming the field and the code `last_owner`.

## Three things to know before you rely on it

**`identity` declares five event types and writes ten.** Its manifest lists
`identity.user.created`, `identity.oidc_client.created`,
`identity.oidc_client.revoked`, `identity.mfa.enabled` and
`identity.mfa.disabled`. It also writes `identity.account.created`,
`identity.member.invited`, `identity.member.accepted`,
`identity.member.role_changed` and `identity.member.removed`.

**Only `identity.user.created` has a payload schema in `core`.** Six of the
other nine have a catalog row and no schema; three — both `oidc_client` types
and `identity.member.accepted` — have **no catalog row at all**, and
`accepted` is not even core's spelling (core says `identity.member.joined`).
The two OIDC types are the ones that matter to a consumer: they are advertised
in the manifest with no published contract behind them. See
[Upgrading](/upgrading/).

**No password recovery.** `POST /v1/users` creates a user with a password and
there is no reset, no recovery token, and no admin API to set one. A user who
forgets their password has no path back in, which in a pilot means somebody
has to be on the other end of a support channel. Plan for that before you ship
it, and read the password policy rather than guessing it — this service refuses
a short password with a `422` naming the field.

**MFA needs a key you supply.** It is built, but `MFA_ENCRYPTION_KEY` is never
generated: unset, and the management routes are not mounted at all. A local
stack from `caf dev` will not set it, so a `404` on `/v1/mfa` there is the
configuration, not a missing feature. See [Hosted pilot
onboarding](/pilot/#step-7--check-the-two-things-this-stack-is-not-giving-you).

## The gate

`go test ./...` is green on a machine with no database and no Docker: the
integration tests skip themselves unless `TEST_DATABASE_URL` is set. Running them
needs the database **and its migrations** — `goose up` is a deploy step, and
without it the OIDC and MFA tests fail with `relation "public.oidc_clients" does
not exist` rather than skipping.

```sh
bin/prime && go vet ./... && gofmt -l . && go test -race ./...

docker compose up -d postgres
export DATABASE_URL="postgres://identity:identity@localhost:5432/identity?sslmode=disable"
goose -dir migrations postgres "$DATABASE_URL" up
TEST_DATABASE_URL="$DATABASE_URL" go test ./...
```

`gofmt -l .` must print nothing. See [Running the
gates](/running-the-gates/#identity--needs-a-database-and-migrations-applied).

- **Repository:** [github.com/cafaye/identity](https://github.com/cafaye/identity)
- **Language:** Go
- **Namespace / event source:** `identity`
- **Container port:** 8080 · `gcr.io/distroless/static-debian12:nonroot`
