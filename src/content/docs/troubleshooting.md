---
title: Troubleshooting
description: cafaye problems keyed by the symptom you can see, not by the component you suspect.
---

[A service is down](/runbooks/service-down/) is organised by which component
you think is broken. This page is organised by **what you can see** — because
that is what a customer tells you, and often it is not the component you would
have guessed.

Each entry: **what to check**, **what it usually means**, **what to do**.

## Login loops back to the sign-in page

The user submits credentials, gets a success, and lands on sign-in again.

### Check

```sh
# 1. How many guard replicas are running?
docker ps --format '{{.Names}}' | grep -c guard
```

### What it usually means

**`guard` runs more than one replica.** The session store is a `Map` in a single
process, and the `__Host-bff-session` cookie holds a session id that only the
replica that created it knows about. The user signs in on replica A and the
next request lands on replica B, which has never heard of it. `/auth/login`
returns `200` every time, so nothing looks broken from the outside.

**Or `guard` restarted between the login and the next request.** Same mechanism:
the sessions are in memory and a restart loses them.

### Do

Run **one** replica of `guard` until the session store is shared. This is a known
limitation recorded in `guard`'s own README, not a misconfiguration: the
`SessionStore` interface is the seam, and a shared store is a later packet.

If the user reports the loop on a single replica, the next thing to check is
whether the browser is actually storing the cookie — `__Host-` prefixed cookies
require HTTPS and `Path=/`, so a plain-HTTP local origin will not keep one.
`parlor` stores its token in `localStorage` rather than a cookie, which is why
its login does not have this failure mode.

---

## Sign-in succeeds but every API call is 401

The browser has a session, and `GET /v1/me` still refuses.

### Check

```sh
# Is it a cookie problem or a token problem?
curl -s -i "$GUARD/v1/me" -H "Authorization: Bearer $TOKEN" | head -3
curl -s -i "$GUARD/auth/me" -H "Cookie: __Host-bff-session=$SESSION_ID" | head -3
```

### What it usually means

**The two surfaces do not cross, by design.** `/v1/*` is bearer JWTs only and a
cookie is not a credential there. `/auth/*` is the BFF: the `__Host-bff-session`
cookie and nothing else. A client holding only a cookie and calling `/v1/me` is
using the wrong credential, and the `401` is correct.

**Or `guard` cannot reach identity's key set.** That is a **`503`**, not a `401`
— deliberately, so a platform outage is not mistaken for an expired token. If
you are seeing `401`, identity is reachable and the token genuinely did not
verify: it is expired, wrongly signed, or carries the wrong `iss` or `aud`.

### Do

Match the credential to the surface. If you hold only a session cookie, call
`/auth/me`; if you hold only a token, call `/v1/*`. A `503` from `/v1/*` means
check `IDENTITY_ISSUER` and `IDENTITY_URL` — see [a service is
down](/runbooks/service-down/#step-3--healthz-is-200-and-readyz-is-503).

---

## Everything returns 404 and nothing is wrong

Especially `POST /v1/users` and `POST /v1/session` on `identity`.

### Check

```sh
curl -s "$IDENTITY/readyz"
```

### What it usually means

**`{"status":"ok","deps":"none"}` — `DATABASE_URL` is unset.**

`identity`'s `/v1` routes are registered **only when `DATABASE_URL` is set**. With
it unset there is no pool, no readiness dependency, and no `/v1` routes at all, so
every one is a clean `404`. That is deliberate: a missing database should be an
unmistakable `404` rather than a pile of `500`s.

The readiness answer that looks the healthiest on the page is the one that breaks
everything.

### Do

Set `DATABASE_URL` and restart. Read it from [rotating
secrets](/runbooks/secret-rotation/#4-a-database-password--the-two-role-overlap)
if the credential also changed — a `deps: "none"` is a *missing* variable, and a
*wrong* one gives you `503` instead.

---

## Uploads fail at 90%

### Check

There is no upload path today. `darkroom` is an **empty repository** — no
manifest, no Dockerfile, no code, no API.

### What it usually means

You are looking for a service that does not exist. The intended design is
**presigned S3 uploads only**, so bytes move straight from the client to object
storage and never through a service process — but none of it is built.

### Do

Nothing on this platform handles uploads yet. Store the bytes in your own
service, or wait. When `darkroom` lands it will own this, and the
[R2 support notes](https://developers.cloudflare.com/r2/api/s3/api) matter: R2's
region is `auto`, its endpoint is account-scoped, and it does not support
`x-amz-checksum-sha256` as `FULL_OBJECT`.

---

## Webhooks arrive but nothing happens

The processor says it delivered. Rows exist. Nothing downstream reacted.

### Check

```sql
select event_type, subject, published_at is null as unpublished, attempts
  from outbox_events
 order by created_at desc limit 10;
```

### What it usually means

**`unpublished: t` on every row — and that is correct today.** `identity` and
`billing` both write `outbox_events` in the same transaction as the domain
change, and **neither starts a publisher loop.** `identity`'s only `Publisher`
implementation is a deliberate no-op, because starting it would mark every event
published and drain the outbox into nowhere. Events are recorded and delivered to
nobody.

**Or the webhook was refused and nothing was stored.** A `400` on the processor
side writes no row at all, so "nothing happened" and "it was rejected" look
identical from outside. See [billing webhooks
failing](/runbooks/billing-webhooks/).

### Do

For your own reactions, read `outbox_events` or build the consumer yourself.
Do **not** start `identity`'s no-op publisher loop to "fix" this — it marks
events published and discards them, which is strictly worse than a visible
backlog. If you are on `billing` and care about money specifically, the webhook
runbook's queries are the ones to run.

---

## A 5xx that disappears when you restart, and comes back

### Check

```sh
curl -s -i "$SERVICE/healthz" | head -1
curl -s -i "$SERVICE/readyz" | head -1
```

### What it usually means

A resource leak, or a dependency whose connection pool is exhausted. Restarting
works because it replaces the pool with a fresh one — which is why the restart
"fixes" it until it does not.

### Do

Read the logs **before** restarting, not after:

```sh
docker logs --since 30m "$SERVICE" 2>&1 | tail -200
```

If `/readyz` was 503 throughout, the dependency was never the problem and the
restart bought nothing. A pool-exhaustion signature looks like repeated
connection errors or a growing wait, not a single stack trace.

---

## `/v1/accounts/{id}` returns 404 for somebody who was just invited

### Check

```sh
# has the invitation actually been accepted?
curl -s "$IDENTITY/v1/accounts" -H "Authorization: Bearer $THEIR_TOKEN"
```

### What it usually means

**The invitation was created but never accepted.** `POST /v1/accounts/{id}/invitations`
returns a `token` in the body and **nothing emails it** — `courier` is a v0
scaffold with no delivery. If nobody was sent the token, the membership was never
created.

**Or the `404` is deliberate.** A non-member gets `404`, never `403`, so the
endpoint is not a tenant-enumeration oracle. A caller who is not a member cannot
tell "this account does not exist" from "this account is not yours to know
about" — and a member of the account never gets this `404`.

### Do

Ask whether the invitation was delivered. If it was not, send the token. If it
was and they accepted it, check the token they used belongs to their account.
Full procedure in [tenant provisioning](/runbooks/tenant-provisioning/).

---

## The members list comes back with empty ids

```json
{"memberships":[{"account_id":"","user_id":"","role":"member","created_at":"0001-01-01T00:00:00Z"}],
 "role":"owner"}
```

### What it usually means

**A known defect, not your data.** `GET /v1/accounts/{accountID}/members`
currently returns only each member's `role`; `account_id`, `user_id`, and
`created_at` come back empty. The count and the roles are correct, and the
membership really exists.

### Do

Verify a membership by reading the account **with that member's own token** — a
`200` proves the membership exists. Do not verify by the members list, and do not
re-provision because of it.

---

## `403` where you expected a `200`, on an account you own

### Check

```sh
curl -s "$IDENTITY/v1/accounts" -H "Authorization: Bearer $TOKEN"
```

### What it usually means

**The caller's role in *that* account is below the route's minimum.** Roles are
`owner` > `admin` > `member`, and the minimum is checked before the handler
runs:

| Operation | Minimum |
| --- | --- |
| Read the account, list members | `member` |
| Rename, invite, remove a member | `admin` |
| Change a role, delete the account | `owner` |

**A `422` mentioning `last_owner` instead** means you are trying to remove the
last owner. Promote somebody else to `owner` first, then step down. The `422`
names the field and the code, which is more useful than it looks.

### Do

Check the role with `GET /v1/accounts` — it returns the **caller's** role per
account, which is not a property of the account and is the number the check
compares. A `404` rather than a `403` means a membership problem; see the entry
above.

---

## Stripe webhooks are failing

### Check

```sql
select count(*) filter (where processed_at is null)   as unprocessed,
       count(*) filter (where error like 'ignored:%')  as ignored,
       count(*) filter (where error like 'failed:%')  as failed
  from processor_webhooks
 where created_at > now() - interval '24 hours';
```

### What it usually means

Three different things, and the status code in Stripe's dashboard splits them:

- **`400`** — the signature did not verify. **Nothing was stored**, so there is no
  row to replay. Usually a secret that was rotated on one side only, clock skew
  past the 300-second tolerance, or a proxy that rewrote the body.
- **`503`** — `billing` has no signing secret configured. Its fault, not Stripe's.
- **`200` with a `failed:` row** — verified, stored, and the mapping raised.
  Parked for a human. Stripe will not retry and should not.

### Do

[Billing webhooks failing](/runbooks/billing-webhooks/) — the full procedure,
including why a replay is safe by construction and how to force Stripe to resend
what a `400` lost.

---

## `muse` will not start

### Check

```sh
docker logs --tail 50 muse 2>&1
```

### What it usually means

**`MUSE_VAULT_KEY` is missing, is not base64, or does not decode to 32 bytes.**
All three are verified refusals:

```
MUSE_VAULT_KEY=''            -> REFUSED: MUSE_VAULT_KEY is not set
MUSE_VAULT_KEY='not-base64!'  -> REFUSED: MUSE_VAULT_KEY is not valid base64
```

The error names the variable and **never its value** — a variable's value in a
boot error is a credential in whatever the operator pastes the error into. There
is no default and no fallback, by design: a vault that boots with a fallback key
is a vault whose keys are readable by anyone who has read the source.

### Do

```sh
uv run python -m muse.vault     # prints a fresh 44-character base64 key
```

Set it to exactly that output. If `muse` starts and then every provider call
fails to decrypt, the key is not the one the rows were sealed under — see
[rotating secrets](/runbooks/secret-rotation/#3-the-muse-vault-key--cannot-be-rotated).

---

## A `caf` command exits 2 with "usage"

### Check

```sh
caf help <command>
```

### What it usually means

`caf` uses Go's standard `flag` package, so there are two rules, and both produce
exit 2:

**Flags must come before positional arguments.**

```sh
caf deploy --dry-run identity     # works
caf deploy identity --dry-run     # usage error
```

**`caf init` takes no positional argument.** It operates on a directory:

```
$ caf init my-saas
caf: usage: caf init wants 0 arguments, got 1 (usage: caf init [flags])
```

The command that takes a name is `caf new my-saas`. And if the command is one of
`init`, `new`, `dev`, `deploy`, `gen`, or `mcp`, the usage error is a red
herring — the real answer is that the command is a v0 stub:

```
$ caf new my-saas
caf: caf new: not implemented in v0
```

Exit 1, not 2. Only `version`, `doctor`, `contract lint`, and `contract resolve`
do real work.

### Do

[Getting started](/getting-started/#step-3--read-what-the-cli-can-do) — the
verified command table, with the two that bite called out.

---

## `caf contract lint` fails on a manifest I did not change

### Check

```sh
caf contract lint /path/to/cafaye
```

### What it usually means

**Three repositories fail on the current tree, and always have:**

| Repository | What the linter says |
| --- | --- |
| `caf` | `is missing required fields ["language", "core", "repository", "owner"]` |
| `courier` | `exposes/events/0: "email.queued" does not match "…"` |
| `parlor` | `is missing required fields ["name", "language", "core", "repository", "owner"]` |

`parlor`'s is the pre-`core` `apiVersion: cafaye/v0-draft` shape. `courier`'s is
a real disagreement about spelling: two segments (`email.queued`) against a
schema that requires three (`courier.email.queued`). Specs are manager-owned, so
the fix is a decision, not a keystroke.

### Do

Lint the specific manifest you changed rather than the whole tree, and treat
these three as known-red. A linter that is always red gets ignored, which is
worse than a smaller gate that is honest.

---

## Nothing is broken and nothing is happening

No error, no log line, no reaction — an action that should have had a
consequence and did not.

### What it usually means

**There is no event bus running.** No service starts an outbox publisher loop
and no broker is deployed. `core` specifies the transactional outbox and NATS as
the transport; the table and the transactional discipline are implemented, and
the transport is not.

This also applies to anything you expected to be automatic in
[provisioning](/runbooks/tenant-provisioning/): the invitation email is not sent,
because `courier` sends nothing.

### Do

Read `outbox_events` directly, or build the consumer. Do not start `identity`'s
no-op publisher loop — it marks events published and discards them, which loses
information rather than delivering it.

---

## Reporting something that is not here

If the fix is not on this page, it is one of two things: a command that does not
exist yet, or a bug in a service repository. Both are worth reporting with the
same evidence, and both are cheap to act on:

- **a command that does not exist** — the exact invocation, the exact message,
  and the exit code. Exit 2 with "unknown command" means it was never wired;
  exit 1 with "not implemented in v0" means it was wired and is a stub.
- **a bug** — the service's `LOG_LEVEL=debug` output around the failure, the
  request that produced it, and the `trace_id` from the response. Every
  non-2xx is `application/problem+json` and carries a `trace_id` that matches the
  `X-Trace-Id` response header, and the service logs its internal failures
  against that same id. **Quote the id, not the error** — the error is written for
  a caller and deliberately says nothing about hosts, ports, or passwords.

## See also

- [A service is down](/runbooks/service-down/) — the same ground, keyed by
  component.
- [Runbooks](/runbooks/) — the five procedures.
- [Topology](/architecture/topology/) — ports, probes, and environment
  variables.
