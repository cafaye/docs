---
title: Tenant Provisioning
description: How a new customer's account is created end to end, verified against a running identity service.
---

Provisioning a design partner means creating a tenant, putting somebody in it
who can sign in, and being able to prove both afterwards. This runbook does that
against `identity`, which is the only service that owns tenancy.

**Every response body and status code in this runbook is quoted from a real
session** against `identity` at commit `27fe8a6`, with a real Postgres behind it.
Where a step's output is worth checking by eye, the check is the step.

## What you need

- `identity` running with `DATABASE_URL` set. The `/v1` routes are only
  registered when it is, so an unset database is a clean `404` on every
  endpoint below rather than an authentication error.
- `curl`. Nothing else.
- The customer's **account name** (1–120 characters) and their **first user's
  email address**. The slug is derived from the name; you do not choose it.

## Before you start: what "provisioned" means here

Registration creates **two** things in one transaction: a `users` row and a
**personal account** for that user, plus an owner membership. So a registered
user already has an account — one nobody chose, named after them, with a slug
like `ada-8a2d614900000000`.

A design partner's tenant is the *second* account: a deliberate, non-personal
one with a slug somebody can put in a hostname. Both exist. That is the
platform's shape, not an accident of this procedure, and a customer with both
accounts is normal.

## Step 1 — set the base URL and check the service is ready

```sh
export B=http://localhost:8080
curl -s "$B/readyz"
```

```json
{"status":"ok","deps":"postgres"}
```

`deps: "postgres"` is the one that matters. `deps: "none"` means `DATABASE_URL`
is unset — there is no pool, no readiness dependency, and **no `/v1` routes at
all**. That is a `404` on every call in this runbook, and it is the single most
common reason provisioning appears to do nothing.

## Step 2 — create the customer's first user

```sh
curl -s -o user.json -w 'HTTP %{http_code}\n' \
  -X POST "$B/v1/users" \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@acme.example","password":"correct-horse-battery-staple"}'
cat user.json
```

```
HTTP 201
{"id":"8a2d6149-374d-4874-899a-59eb6b999c9e","email":"ada@acme.example"}
```

The password is the customer's to choose. Password rules are enforced here and
refused with a `422` that names the field:

```
HTTP 422
{"status":422,"title":"Validation failed","detail":"the request has an invalid field",
 "code":"validation_failed","trace_id":"9f8b94db-…","errors":[{"field":"password","code":"too_short"}]}
```

A taken address is a `409`, and it says so without confirming the account:

```
HTTP 409
{"status":409,"title":"Conflict","detail":"an account already exists for that email address",
 "code":"conflict","trace_id":"c774dbc1-…"}
```

Store the `id`. Every later step keys on it.

## Step 3 — authenticate as them and hold the token

```sh
curl -s -o session.json -w 'HTTP %{http_code}\n' \
  -X POST "$B/v1/session" \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@acme.example","password":"correct-horse-battery-staple"}'

export TOKEN=$(python3 -c 'import json;print(json.load(open("session.json"))["token"])')
```

```json
{"token":"iV63Rk7vDTft3yAh0pFlKvCfh-lB-33Uk_Bv0AGBLig","expires_at":"2026-10-30T07:51:38.919827Z"}
```

`POST /v1/session` also sets a `__Host-session` cookie to the same token. For a
script, the bearer header is what you want; the cookie exists for the browser.

**Every unusable credential gets one sentence and one status.** A wrong
password, an unknown address, and a locked account are deliberately
indistinguishable in their wording, so this endpoint cannot be used to
enumerate who has an account:

```
HTTP 401
{"status":401,"title":"Unauthorized","detail":"authentication is required to access this resource",
 "code":"unauthorized","trace_id":"…"}
```

A locked account is `423 account_locked` **with** a `Retry-After` header — the
one credential failure that does say something, because a client must be able to
back off.

## Step 4 — confirm the personal account exists

```sh
curl -s "$B/v1/me" -H "Authorization: Bearer $TOKEN"
curl -s "$B/v1/accounts" -H "Authorization: Bearer $TOKEN"
```

```json
[{"id":"c65b1a68-19d0-4866-b0d8-505fb5d4451f",
  "name":"ada","slug":"ada-8a2d614900000000","personal":true,"role":"owner",
  "created_at":"2026-09-30T10:51:38.752309+03:00"}]
```

`personal: true` and `role: owner`. This is the free-floating account. You are
about to make the real one.

## Step 5 — create the tenant

```sh
curl -s -o account.json -w 'HTTP %{http_code}\n' \
  -X POST "$B/v1/accounts" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Acme Corp"}'

export ACC=$(python3 -c 'import json;print(json.load(open("account.json"))["id"])')
```

```
HTTP 201
{"id":"8f80905d-a8d1-470f-aa01-84fc79d81e4b","name":"Acme Corp","slug":"acme-corp",
 "personal":false,"role":"owner","created_at":"…","updated_at":"…"}
```

Three things to read off that response.

**`personal: false`.** This is a team account, deliberately created. A row
nobody asked for is a team account, and team is the ordinary case.

**`role: "owner"`.** The owner is the authenticated user, never anything from
the request body. There is no version of this body that creates an account owned
by somebody else, and that is the line between "create an account I own" and
"create an account owned by a third party".

**`slug: "acme-corp"`.** Lower-case ASCII alphanumerics separated by single
dashes, one DNS label, at most 63 characters. It is derived from the name at
creation and **never changes** — renaming the account does not move the handle,
and the rename response returns the original slug so a client can see that.

A collision is a `409` and it is deliberate. Two companies both wanting "acme"
get the second one a refusal rather than a silent `-2` nobody chose:

```
HTTP 409
{"status":409,"title":"Conflict",
 "detail":"an account with that name already exists; its handle is the name in lower case with dashes",
 "code":"conflict","trace_id":"fcc2afc1-…"}
```

Pick a different name. There is no admin override and no slug parameter.

## Step 6 — invite the rest of the team

```sh
curl -s -o invite.json -w 'HTTP %{http_code}\n' \
  -X POST "$B/v1/accounts/$ACC/invitations" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"email":"bob@acme.example","role":"member"}'
```

```
HTTP 201
{"id":"61c58dfa-83ff-4b41-aa88-89a78e0d5c7c",
 "account_id":"8f80905d-a8d1-470f-aa01-84fc79d81e4b",
 "email":"bob@acme.example","role":"member",
 "token":"BQq4_R07yGbMkxRoc55Y6rL0vE2l9WtcnPW-BP5EGdg",
 "expires_at":"2026-10-07T10:51:50.606107+03:00","created_at":"…"}
```

**The `token` is in the response body, and `courier` does not send it.** This is
the step people expect to be automated and is not. `courier` is a v0 scaffold
with no Swoosh, no provider adapter, and no job queue, so nothing emails this
token. Deliver it yourself — out of band, to the address you just invited, and
by a channel you trust.

`expires_at` is seven days out. An expired invitation is `410`, and a used one
is `410`; both mean "ask for a new one", and re-posting to `/invitations` is the
fix. A wrong token is `404` with the same sentence an unknown account would get,
so a guessed token is useless.

**`role` may only be `admin` or `member`.** `owner` is not invitable — an
existing owner promotes a member to owner after they have joined. Inviting
`owner` is a `422` naming the field.

## Step 7 — the invitee joins

They register and log in like anybody else — there is no invite-only signup
path, because the invitation does not create the user:

```sh
curl -s -X POST "$B/v1/session" -H 'Content-Type: application/json' \
  -d '{"email":"bob@acme.example","password":"<their password>"}' -o bsession.json
export BTOKEN=$(python3 -c 'import json;print(json.load(open("bsession.json"))["token"])')

curl -s -o accept.json -w 'HTTP %{http_code}\n' \
  -X POST "$B/v1/invitations/accept" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $BTOKEN" \
  -d '{"token":"<the token from step 6>"}'
```

```
HTTP 200
{"account_id":"8f80905d-a8d1-470f-aa01-84fc79d81e4b",
 "user_id":"d9bfa571-01f5-4701-9cb6-efeece5c782d",
 "role":"member","created_at":"2026-09-30T10:51:58.202431+03:00"}
```

There is no account in the path: the token names the account. The caller still
has to be authenticated, because the membership being created is theirs.

## Step 8 — promote somebody to owner, if you need a second one

```sh
curl -s -X PATCH "$B/v1/accounts/$ACC/members/$BOB" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"role":"owner"}'
```

**This is owner-only.** An `admin` or a `member` attempting it gets `403 your
role in this account does not permit this action` — the route's minimum role is
`owner`, checked before the handler runs.

## Roles, and the two rules that protect the account

Roles are `owner`, `admin`, `member`. They are a PostgreSQL enum, ordered, and
the ordering is what the minimum-role check compares.

| Operation | Minimum role |
| --- | --- |
| Read the account, list members | `member` |
| Rename, invite, remove a member | `admin` |
| **Change a role, delete the account** | `owner` |

Two refusals are worth knowing before you hit them.

**The last owner is never removed.** An owner demoting themselves while they
are the only owner gets:

```
HTTP 422
{"status":422,"title":"Validation failed",
 "detail":"you are the only owner of this account and cannot change your own role",
 "code":"validation_failed","errors":[{"field":"role","code":"last_owner"}]}
```

Promote somebody else to `owner` first, then step down. Verified: with two
owners, the demotion succeeds.

**A non-member gets `404`, never `403`.** Reading an account you are not a
member of:

```
HTTP 404
{"status":404,"title":"Not found","detail":"no such account is visible to you",
 "code":"not_found","trace_id":"…"}
```

That is deliberate and it is a security property, not a formatting choice. A
`403` would tell any authenticated caller that the account id they guessed is
real, which is a free tenant-enumeration oracle on a table whose ids are the
only thing between one customer and another. So the two denials are kept apart:
`404` when the resource is not yours to know about, `403` when it is and you
lack the permission. **A `404` on an account you believe exists is usually a
membership problem, not a missing account.** Check the membership.

## Step 9 — verify the tenant

Verification is a separate step from provisioning. Applying the changes is not
evidence that they worked; reading them back is.

```sh
# 1. the account, as its owner
curl -s "$B/v1/accounts/$ACC" -H "Authorization: Bearer $TOKEN"

# 2. the new member can read it (role: member is enough)
curl -s "$B/v1/accounts/$ACC" -H "Authorization: Bearer $BTOKEN"

# 3. a complete outsider cannot — and gets 404, not 403
curl -s -o /dev/null -w '%{http_code}\n' "$B/v1/accounts/$ACC" -H "Authorization: Bearer $SOMEONE_ELSE"
```

Steps 1 and 2 must both be `200`. Step 3 must be `404`. If step 2 is `404`, the
invitation was never accepted.

:::caution[Do not verify with the members list]
`GET /v1/accounts/{accountID}/members` currently returns only the `role` of each
member — every `account_id`, `user_id`, and `created_at` comes back empty:

```json
{"memberships":[{"account_id":"","user_id":"","role":"member","created_at":"0001-01-01T00:00:00Z"},
                {"account_id":"","user_id":"","role":"owner","created_at":"0001-01-01T00:00:00Z"}],
 "role":"owner"}
```

The membership **is** correct — the count and the roles are right, and
`GET /v1/accounts/{id}` from the new member's own token proves the membership
exists. Only the per-member identifiers are missing from that one endpoint. Use
step 2 above as your verification and treat the empty ids as a known defect
rather than as evidence of a failed provision.
:::

### Also verify the events were recorded

`identity` writes its outbox in the same transaction as the domain change, so a
provisioned tenant leaves rows behind:

```sh
psql "$DATABASE_URL" -c \
  "select type, subject, published_at is null as unpublished, attempts
     from outbox_events order by occurred_at desc limit 10;"
```

```
           type           |               subject                | unpublished | attempts
--------------------------+--------------------------------------+-------------+----------
 identity.member.accepted | 8f80905d-a8d1-470f-aa01-84fc79d81e4b | t           |        0
 identity.account.created | 8f80905d-a8d1-470f-aa01-84fc79d81e4b | t           |        0
 identity.user.created    | d9bfa571-01f5-4701-9cb6-efeece5c782d | t           |        0
```

`unpublished: t` on every row is **expected and not a fault**. No service starts
a publisher loop; `identity`'s only `Publisher` implementation is a deliberate
no-op. So a tenant is provisioned and its events are recorded, and nothing is
delivered to anyone. Do not go looking for a broker, and do not "fix" this by
starting the loop — that marks events published and drains the outbox into
nowhere.

The `DATABASE_URL` above is the one `identity` reads. `psql` takes the same
DSN, which is the one convenience of database-per-service worth having.

## What does not happen automatically

| Step | Why not | What to do |
| --- | --- | --- |
| The invitation email | `courier` is a v0 scaffold with no delivery | Send the token yourself |
| A billing customer | `billing` never calls Stripe; `processor` and both price ids are null in practice | Create plans and customers through `/v1` once you need them — [billing](/services/billing/) |
| A `guard` role mapping | `guard` verifies tokens; role enforcement is `identity`'s | Nothing. `/v1/*` is bearer-only and `identity` is the authority |
| Any event delivery | No publisher loop runs | Build the consumer yourself, or read the outbox |

## Rolling it back

`DELETE /v1/accounts/{accountID}` is **owner-only** and removes the account and
everything scoped by it. There is no undo and no soft delete.

Before you run it, take a backup. The [backup and restore
runbook](/runbooks/backup-and-restore/) is the procedure, and restoring a
single tenant out of a fresh dump is a query, not a restore.

Do not delete the tenant because a member is misconfigured. Membership is
correctable in place: change the role, or remove the membership. Deleting the
account to fix a permissions problem destroys every row scoped by it.

## See also

- [Topology](/architecture/topology/) — the routes, roles, and ports this
  runbook uses.
- [A service is down](/runbooks/service-down/) — if step 1's `readyz` is 503.
- [Rotating secrets](/runbooks/secret-rotation/) — the customer's credentials.
