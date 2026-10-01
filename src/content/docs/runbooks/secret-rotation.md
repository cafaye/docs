---
title: Rotating Secrets
description: Changing signing keys, Stripe secrets, provider credentials, and database passwords without downtime — and the two that cannot be rotated yet.
---

Rotation has one shape: **add the new credential while the old one still works,
move traffic across, then remove the old one.** Anything that inverts that order
turns a rotation into an outage, because a service that cannot open a new
connection does not degrade — it fails.

This page covers what can be rotated today, and is explicit about the two
things that cannot.

## The inventory

| Secret | Held by | Rotatable today | Method |
| --- | --- | --- | --- |
| Stripe **webhook** signing secret | `billing` | **yes, with no downtime** | `STRIPE_WEBHOOK_SECRETS` |
| Stripe **API** key | `billing` | **yes** | create the new restricted key, deploy it, then revoke the old one |
| LLM **provider** credential (OpenAI, Anthropic) | `muse` vault | **yes, with no downtime** | re-seal the row |
| Database password (`DATABASE_URL`) | every service with a database | **yes, via a second role** | `CREATE ROLE` → cut over → `DROP ROLE` |
| Object-storage credential (AWS or R2) | `darkroom` | **yes** | the SDK credential chain; put both keys in the environment, cut over, revoke |
| `COURIER_SECRET_BOX_KEY` | `courier` | **no** | every sealed webhook secret would need re-sealing; see [below](#8-the-two-sealing-keys-that-cannot-be-rotated) |
| `MFA_ENCRYPTION_KEY` | `identity` | **no** | same shape, and it fails *closed*; see [below](#8-the-two-sealing-keys-that-cannot-be-rotated) |
| `identity` OIDC signing key | `identity` | **partially** | see [below](#5-the-identity-oidc-signing-key--configured-not-rotatable) |
| `MUSE_VAULT_KEY` | `muse` | **no** | see [below](#3-the-muse-vault-key--cannot-be-rotated) |
| `COURIER_MAIL_ADAPTER` and its `COURIER_SMTP_*` | `courier` | **yes** | a deployment decision, not a stored secret — see [below](#6-an-email-provider-credential-in-courier--required-not-optional) |
| Scoped API token | `identity` | **yes, by issuing a second one** | `POST /v1/accounts/{id}/api-keys` → cut over → `DELETE …/{key_id}` |
| Session secret | `guard` | **n/a** | sessions are a `Map` in one process, signed by `identity` |

Three of those rows are new and all three were previously written as "there is
nothing to rotate here". `billing` now makes **three kinds of request to
Stripe** — create a Checkout Session, cancel a subscription, move one between
plans — so there is a Stripe API key and it is rotatable. `darkroom` reads its
object-storage credential from the AWS SDK's own chain, so the rotation is two
environment variables and a restart. And `courier` now has a **real** mail
adapter rather than one that rendered into memory and mailed nobody, so its SMTP
credential is an ordinary rotatable secret — see [section
6](#6-an-email-provider-credential-in-courier--required-not-optional).

**Three more rows are new, and they are the ones a reader is most likely to
mis-plan around, because they look like ordinary environment variables and are
not.** The two sealing keys were missing entirely, and they are the two keys that
most damage a database restore when they are mishandled:

- **`COURIER_SECRET_BOX_KEY` and `MFA_ENCRYPTION_KEY` are sealing keys**, and
  rotating one is a data-loss event rather than a procedure. `courier`'s own
  `runtime.exs` says so in one line: *"Rotating it means every stored secret has
  to be re-sealed under the new key, which is why it is a deployment concern and
  not a courier feature."* Neither has tooling, so both belong in the same
  category as `MUSE_VAULT_KEY`. See [section 8](#8-the-two-sealing-keys-that-cannot-be-rotated).
- **`COURIER_MAIL_ADAPTER` is not a secret at all** — it is a deployment decision
  with teeth, and it fails in a way that reads like something else entirely. See
  [section 6](#6-an-email-provider-credential-in-courier--required-not-optional).
- **A scoped API token is a rotation by issuance, not a cutover**, which is the
  cheapest rotation on this page and the only one with no downtime window at all.
  See [section 7](#7-a-scoped-api-token-in-identity--issue-a-second-one-then-revoke-the-first).

## The general rule about how these services read configuration

Every service reads its environment at startup, validates it, and **never
mutates it afterwards**. A value that is present but invalid fails startup rather
than falling back to a default, so a typo in a deployment is a crash with a
message instead of a service listening on the wrong port.

Two consequences for rotation:

- **A changed environment variable requires a restart.** There is no live
  reload. "Deploy the new value" and "roll the service" are one operation.
- **There is no default to fall back to**, in either direction. The old value
  does not linger in the process, and a missing one is not silently tolerated
  (with the deliberate exception of `DATABASE_URL` in `identity`, which is
  optional in v0 and whose absence is visible as `deps: "none"`).

---

## 1. The Stripe webhook signing secret — zero downtime, no restart

This is the cleanest rotation in the platform, because the code was written for
it. `billing` accepts a **comma-separated list** of signing secrets and tries
every one of them:

```sh
STRIPE_WEBHOOK_SECRETS=whsec_new,whsec_old
```

`STRIPE_WEBHOOK_SECRET` (singular) is the fallback when the plural is unset. The
first secret that verifies a request wins; a body that verifies under none of
them is a `400`.

**Rotate in this order**, and there is no step that returns an error:

```sh
# 1. In the Stripe dashboard, add a second signing secret to the endpoint.
#    Stripe now signs with the NEW secret and still accepts the OLD one.

# 2. Tell billing about both. This is the overlap window.
export STRIPE_WEBHOOK_SECRETS=whsec_new,whsec_old

# 3. Roll billing so it reads the list. Every webhook verifies against the new
#    secret; the old one is accepted but unused.

# 4. Once you have confirmed traffic is flowing (see verification below),
#    remove the old secret from Stripe AND from the list:
export STRIPE_WEBHOOK_SECRETS=whsec_new
#    roll billing again
```

The order matters in one place: **remove the old secret from the list only after
you have removed it from Stripe, or the reverse — never both at once.** If
Stripe signs with a secret billing does not hold, every webhook is a `400`, and
Stripe retries until it gives up.

:::caution[`503` means billing cannot check at all]
With none of `STRIPE_WEBHOOK_SECRET` / `STRIPE_WEBHOOK_SECRETS` set,
`POST /v1/webhooks/stripe` answers **503**, not 400. That is deliberate: telling
Stripe its signature is bad when the service cannot check it at all sends an
operator looking in exactly the wrong place. If you see 503 on the webhook
endpoint, look at your deployment's environment, not at Stripe.
:::

### Verify

```sh
# the endpoint is configured, not erroring on configuration
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BILLING/v1/webhooks/stripe" \
  -H 'Stripe-Signature: t=1,v1=deadbeef' -d '{}'
```

A `400` means billing is configured and rejected a bad signature — that is the
healthy answer for this probe. A `503` means it is not configured.

Then confirm rows are still landing with the new secret:

```sql
select stripe_event_id, type, processed_at, error
  from processor_webhooks
 order by created_at desc limit 10;
```

A rising `error` count with an `ignored:` or `failed:` prefix is a mapping
problem, not a rotation problem. See [billing webhooks
failing](/runbooks/billing-webhooks/).

---

## 2. An LLM provider credential in the muse vault — zero downtime

The vault holds one API key per provider, AES-256-GCM encrypted, one row per
provider in `vault_secrets`. Replacing a row is an upsert:

```sql
insert into vault_secrets (provider, ciphertext, key_version)
values (%s, %s, %s)
on conflict (provider) do update
   set ciphertext = excluded.ciphertext,
       key_version = excluded.key_version,
       updated_at = now()
```

**`muse` resolves the credential per call and does not cache it at
construction.** That is the whole reason a deploy is not required to rotate one:
a resolver that cached at boot would mean a rotated key takes effect on the next
process restart, which is exactly the failure the per-call resolution exists to
prevent. So: re-seal the row, and the next request uses the new key.

`muse` has no admin API in v1, so this is a session against the database:

```sh
MUSE_VAULT_KEY='<the key>' MUSE_DATABASE_URL='postgres://…' uv run python - <<'PY'
import asyncio, os
from muse.db import PsycopgDatabase
from muse.redaction import Secret
from muse.vault import Vault, load_vault_key

async def main():
    db = await PsycopgDatabase.open(os.environ["MUSE_DATABASE_URL"])
    vault = Vault(db, load_vault_key())
    await vault.put("openai", Secret(input("new openai key: ")))
    print("stored:", await vault.providers())

asyncio.run(main())
PY
```

There is no window: the old ciphertext is replaced in one statement, and the
next request decrypts the new one. **If a request fails immediately after a
rotation with a decryption error rather than an upstream 401, the row was
written under a different `MUSE_VAULT_KEY`** — that is the one failure mode with
no overlap, and it is covered in the next section.

---

## 3. The muse vault key — **cannot be rotated**

`MUSE_VAULT_KEY` is the AES-256 key every provider credential is encrypted
under. It must be present, must be base64, and must decode to exactly 32 bytes,
or `muse` refuses to start. All three failure modes are verified:

```
MUSE_VAULT_KEY=''           -> REFUSED: MUSE_VAULT_KEY is not set
MUSE_VAULT_KEY='not-base64!' -> REFUSED: MUSE_VAULT_KEY is not valid base64
MUSE_VAULT_KEY='AAAA…'       -> REFUSED: MUSE_VAULT_KEY is not valid base64
```

and a good one:

```sh
$ uv run python -m muse.vault
GYGhZplT3eki…                        # 44 characters, decodes to 32 bytes
```

**There is no rotation path.** The `key_version` column exists in
`vault_secrets` and is always `1`; its stated purpose in the source is so that *"a
later rotation can re-encrypt in place without a migration or a second
column"*, and that rotation has not been written. `muse` reads exactly one key
from the environment.

What this means operationally:

- **Rotating `MUSE_VAULT_KEY` makes every stored credential undecryptable.** The
  failure surfaces as a decryption error — an `InvalidTag`, which is
  deliberately surfaced as a `401` rather than a `500` so it does not read as a
  wrong upstream key and send you to rotate the provider credential instead. It
  is still a total loss of the vault's contents.
- **Back the key up somewhere other than the database dump.** A
  [dump](/runbooks/backup-and-restore/) of `vault_secrets` is unreadable without
  it, and it cannot be recovered from the dump.
- **The only safe operation is a restore**: dump `vault_secrets`, generate a new
  key, and re-seal every row under it. That is a maintenance window with `muse`
  down, and it is not a documented procedure because the tooling for it does not
  exist yet.

Treat `MUSE_VAULT_KEY` as a **non-rotatable secret**: generate it once, store it
in a secret manager, and plan for replacing the *provider* keys (section 2) when
a provider credential leaks, not the vault key.

---

## 4. A database password — the two-role overlap

`ALTER ROLE … PASSWORD` takes effect **immediately for new connections**, and
the old password stops working at that instant. Verified:

```sh
psql -d postgres -c "ALTER ROLE identity WITH PASSWORD 'new-pw';"
# ALTER ROLE

PGPASSWORD=old psql -d identity -tAc 'select 1'
# FATAL:  password authentication failed for user "identity"

PGPASSWORD=new psql -d identity -tAc 'select 1'
# 1
```

So the naive order — change the password, then roll the services — produces a
window in which every service that needs a *new* connection is refused. A
running service with a warm pool survives; a service that restarts, or one whose
pool recycles a connection, does not.

**Use a second role instead.** The overlap is real and verified:

```sh
# 1. Create the replacement role alongside the existing one.
psql -d postgres -v ON_ERROR_STOP=1 -c \
  "CREATE ROLE identity_rotated LOGIN PASSWORD 'new-pw';"

psql -d identity -v ON_ERROR_STOP=1 -c "
  GRANT ALL PRIVILEGES ON ALL TABLES   IN SCHEMA public TO identity_rotated;
  GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO identity_rotated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO identity_rotated;"

# 2. Both work at once. This is the window.
PGPASSWORD=identity       psql -U identity         -d identity -tAc "select 'ok'"   # ok
PGPASSWORD=new-pw-2026    psql -U identity_rotated -d identity -tAc "select 'ok'"   # ok

# 3. Roll each service with DATABASE_URL pointing at the new role.
#    (An environment change requires a restart — nothing reads it live.)

# 4. Only after every service is on the new role, drop the old one.
psql -d identity -c "REASSIGN OWNED BY identity_rotated TO identity; DROP OWNED BY identity_rotated;"
psql -d postgres -c "DROP ROLE identity_rotated;"
```

Step 4 has a sharp edge worth knowing before you reach it:

```
ERROR:  role "identity_rotated" cannot be dropped because some objects depend on it
DETAIL:  10 objects in database identity
```

Dropping the role that holds the grants fails until you `REASSIGN OWNED` and
`DROP OWNED` first. Discovering this with old credentials already revoked and
services half-migrated is a bad afternoon.

**Do this per service.** Each service has its own database and its own role, and
`identity`'s role is not `muse`'s. Rotating them in one sitting doubles the blast
radius for no benefit.

### Verify

```sh
# the new role serves the application, not just psql
curl -s "$B/healthz"
curl -s "$B/readyz"
```

Liveness, which says nothing about the database:

```json
{"status":"ok"}
```

Readiness, which is the one that has to name it:

```json
{"status":"ok","deps":"postgres"}
```

`deps: "postgres"` is the check. If readiness says `deps: "none"`, the service
came up with **no database at all** — a typo in the DSN, or a missing
environment variable, and a symptom that looks nothing like a wrong password.

---

## 5. The identity OIDC signing key — configured, not rotatable

`guard` verifies bearer tokens against identity's published JWKS at
`{IDENTITY_ISSUER}/.well-known/jwks.json`, and that mechanism is real and
running. **This section used to say the key set did not exist**, which stopped
being true when the OIDC provider landed.

`OIDC_SIGNING_KEY` is read from the environment and **never generated at boot** —
a generated key publishes a document no caching verifier has seen, and two
processes behind a load balancer would each publish a different one. There is
**one** signing key, and the library's token-encryption key is *derived* from it
with a domain-separated SHA-256 rather than configured separately. So there is one
secret to rotate, not two.

**There is still no rotation tooling.** The procedure that applies the moment one
exists is worth writing down now, because two of its properties are non-obvious:

**Publish the new key before you sign with it.** `guard` holds a fetched key set
in memory for `IDENTITY_JWKS_TTL_MS` (default `300000` — five minutes). A token
naming a `kid` that is not in the cached set triggers **one** forced refresh per
cache window, and is then refused. So: publish the new public key at the JWKS
URL, wait longer than the TTL, and only then start minting tokens with it.

**The TTL is also the revocation window.** A key identity withdraws keeps
verifying until the cache expires. That is stated in `guard`'s own README and it
is the number to plan against: withdrawing a compromised signing key does not
take effect for up to `IDENTITY_JWKS_TTL_MS`, and the only lever is lowering the
TTL and paying for more JWKS fetches.

Order, when the tooling lands:

1. Put the new key in `OIDC_SIGNING_KEY` and roll. **Old key no longer signs** —
   this is the step with no overlap, and it is why tooling matters.
2. Wait longer than `IDENTITY_JWKS_TTL_MS` (5 minutes by default) so every
   verifier's cache has refreshed.
3. After the longest token lifetime has passed (see below), the old key is gone
   from circulation. Lower the TTL if you want revocation to be immediate.

Because step 1 has no overlap, **a rotation today is a cutover, not a
rotation.** There is no point at which both keys verify, so schedule it.

`guard` enforces **no ceiling on token lifetime** — it verifies `exp` and `nbf`
and trusts `identity` to mint short-lived ones. Access tokens live fifteen
minutes and **there are no refresh tokens**, so "the longest token lifetime" above
is bounded at fifteen minutes. That is convenient here and it is also the thing
that will hurt a long-running session: a browser cannot renew, and there is no
end-session endpoint either.

---

## 6. An email provider credential in courier — required, not optional

This row changed from "there is nothing to rotate here" to "there is a real
credential here", and the reason it is worth reading is the failure it replaced.

**What used to happen.** `courier` shipped `Swoosh.Adapters.Local` as its
production adapter. `Local` renders a message into memory and returns a
provider-shaped id **without opening a socket**. So a released courier accepted
every send, wrote an `outbox_events` row for it, published
`courier.email.delivered`, and mailed nobody — with no error, no warning, and a
green dashboard. Everything downstream of those events believed a person had
been told something.

**What happens now.** The adapter is required config with no default, and a
courier that cannot deliver **refuses to boot**:

| Variable | Default | Notes |
| --- | --- | --- |
| `COURIER_MAIL_ADAPTER` | **none — required** | `smtp` is the only adapter that reaches a provider |
| `COURIER_SMTP_HOST` | — | required when the adapter is `smtp` |
| `COURIER_SMTP_PORT` | `587` | the submission port |
| `COURIER_SMTP_USERNAME` | — | required unless `COURIER_SMTP_AUTH=never` |
| `COURIER_SMTP_PASSWORD` | — | required unless `COURIER_SMTP_AUTH=never` |
| `COURIER_SMTP_AUTH` | `always` | `always` · `never` · `if_available` |
| `COURIER_SMTP_TLS` | `always` | `always` · `never` · `if_available` |
| `COURIER_SMTP_SSL` | `false` | `true` for implicit TLS on 465 |

`courier` ships **one** adapter — `Swoosh.Adapters.SMTP` — and selects it with
`COURIER_MAIL_ADAPTER`. There is no default, and the absence is load-bearing:

- **Unset, `courier` refuses to start.** `Courier.MailerAdapter.adapter!/1` raises
  naming the variable and the two lines to set. The stated reason is the good
  one: *"Without one this process would start, accept every send, and deliver
  nothing."*
- **`COURIER_MAIL_ADAPTER=none` is refused in production.** That value is the
  Local adapter, which renders a message into memory, returns a provider-shaped
  id, and **opens no socket**. A courier configured with it reports every send
  as delivered and mails nobody — so it is development-only and the check is a
  startup gate, not a lint.
- **Any other value is refused by name**, listing the two supported ones.

```sh
COURIER_MAIL_ADAPTER=smtp
COURIER_SMTP_HOST=smtp.your-provider.com
```

The refusal is at boot rather than at send time because the failure is
asymmetric: a warning is one line in a log nobody reads, and by the time somebody
reads it the damage is already recorded as delivered. Courier also checks the
**resolved** adapter rather than the variable, so a config that *looks* like SMTP
but resolves to a silent adapter is refused before any child starts.

**So the rotation is ordinary**, and it is the two-role shape with the relay
instead of Postgres: get the new credential accepted at the provider, deploy it
in `COURIER_SMTP_PASSWORD` with a roll, confirm, then revoke the old one at the
provider. **A changed environment variable requires a restart** (see the general
rule above), and an SMTP server that will not authenticate the new password
fails the boot — so a bad rotation is a deploy that does not happen, not an
outage. There is **no cafaye-side overlap window and no double-send risk**: the
credential is read at startup and never cached.

**A credential is never in a log line.** `courier` prints one startup line
naming the adapter, the host, the port and whether auth is on — *never* the
username and *never* the password, because at SMTP a "username" is very often
the API key. The line is prefixed by `mailer:` and its body is exactly these
four fields, in this order and this spelling:

```
mailer: adapter=smtp host=relay.example port=587 auth=always
```

An unconfigured deployment does not print that line at all — it raises during
`config/runtime.exs`, which runs before the application starts.

---

## 7. A scoped API token in identity — issue a second one, then revoke the first

This is the rotation that needs no downtime window at all, because it is not a
replacement of a single value: it is an **issuance**. `identity`'s `api_keys`
table is the credential that is not a browser session, and it was missing from
this inventory entirely.

What the table holds, and the four facts that matter for rotation:

- **The token is returned exactly once.** `POST /v1/accounts/{account_id}/api-keys`
  returns it in the `201`; what is stored is the lower-case hex **SHA-256
  digest**, never the value. There is no endpoint that re-reads the token, so
  **the `201` is the only place it exists** — losing it means issuing another.
- **`name` is required.** An operator revokes by what they can read, and a token
  with no name is one you can only revoke by copying a uuid out of a list.
- **`expires_at` is required and capped at 365 days** by a `CHECK` constraint in
  the database, not only in Go — a token cannot be created with a longer
  lifetime by a caller that skipped the service layer.
- **`last_used_at` is written on the read path**, and nullable on purpose: "never
  used" and "used at the epoch" are different answers, and a token nobody has
  ever presented is exactly the one an operator wants to notice.

**Rotate it like this.** Both keys are valid at once, so there is no cutover:

1. `POST /v1/accounts/{account_id}/api-keys` with the scopes the new key needs
   and a `name` that says which one it is. Keep the token from the response.
2. Move the consumer onto it — a CI variable, a settings page, an SDK credential.
3. `GET /v1/accounts/{account_id}/api-keys` and confirm `last_used_at` on the
   **old** key stops advancing. That is the check, and it is the only one that
   proves the consumer moved. The field is `omitempty`, so a key that has never
   been presented simply has no `last_used_at` — which is a different answer
   from one carrying a timestamp, and worth distinguishing.
4. `DELETE /v1/accounts/{account_id}/api-keys/{key_id}` with an optional
   `{"reason": "…"}`. It answers **204** and nothing else.

**All three routes are owner-only.** Minting, listing and revoking a scoped API
token each require the `owner` role, checked before the handler runs — so this
is a procedure for somebody who holds the account, not for a service account
that can read an account but not administer its credentials.

**Do not rotate this by deleting first.** A deleted key is dead
immediately — there is no overlap, because the thing you are rotating is the
thing that decides whether the request is allowed.

:::caution[`identity.api_key.revoked` is also the expiry event, and nothing emits that half]
The event `identity.api_key.revoked` covers **both** revocation and expiry. There
is **no sweeper**, so the expiry half is not emitted: nothing writes
`identity.api_key.revoked` when a token simply runs out. A consumer that treats
this type as "all of this account's credentials are gone" will be right about
explicit revocations and silent about expiries. Give tokens an expiry well inside
the window you care about, and revoke explicitly rather than waiting.
:::

---

## 8. The two sealing keys that cannot be rotated

`COURIER_SECRET_BOX_KEY` and `MFA_ENCRYPTION_KEY` are the same shape of problem
as `MUSE_VAULT_KEY`, and they were missing from this page while being the two
keys that most damage a **database restore** when they are mishandled. See the
key table in [backup and restore](/runbooks/backup-and-restore/#the-keys-that-decide-whether-a-dump-is-readable).

**`COURIER_SECRET_BOX_KEY`** is the 32-byte key every **outbound webhook signing
secret** is sealed under, stored in `webhook_endpoints.secret`. Courier generates
those per endpoint and seals them; the key is the only way back. Losing it means
courier cannot sign a single delivery, and there is no rotation path — the
sealed rows would all have to be re-sealed under a new key, and nothing ships
that does it. Generate with `openssl rand -base64 32`, store it away from the
database, and treat it as non-rotatable.

**`MFA_ENCRYPTION_KEY`** seals the TOTP secret in `mfa_credentials.secret_ciphertext`,
base64url and **exactly 32 bytes**, and it is never generated at boot — a
generated key would invalidate every enrolled user's second factor on every
restart. It is unset by default, and unset is a *supported state*: the MFA
management routes are absent and the login challenge is still enforced. Which
means **you may not have one in production yet, and finding that out during an
incident is the wrong time.** The cost of losing it is stated in `identity`'s own
README and it is worse than a vault: on a lost key every sealed secret is
unreadable and every enrolled user fails **closed** at their second factor, so
the only way back is a recovery code or a support ticket.

**There is one piece of good news in `identity`'s design and it is deliberate:**
the sealed value carries a `mfa1.` format prefix *in the stored value rather
than in the schema*, precisely so that a future rotation can read what the
previous key wrote. **The format is versioned; the re-seal procedure is not
written.** A version prefix is the thing that makes rotation possible later, and
it is not rotation.

---

## 9. Secrets that do not exist yet

Do not build a rotation procedure for these; there is nothing to rotate.

- **A Stripe API key for a read-only integration.** `billing` now calls Stripe in
  three ways, so it holds a key — but it is a **restricted** key scoped to the
  Checkout, subscription and plan operations it uses, and the rotation is
  Stripe's restricted-key rotation with no overlap window in the cafaye side.
- **A session secret in `guard`.** Sessions are a `Map` in one process and the
  session id is `identity`'s. Restarting `guard` loses them; there is no key
  material to rotate.
- **A per-message DKIM or provider API key in `courier`.** The adapter speaks
  SMTP and nothing else; there is no HTTP-provider adapter to configure, so a
  provider's REST API key is not a `courier` secret today.
- **A `COURIER_INBOUND_RESEND_SECRET`-shaped inbound credential.** It exists and
  is required, but it authenticates *your* error-reporting relay into `courier`,
  not a cafaye-facing credential, so rotating it is an ops detail rather than a
  customer-facing one.

**An email provider credential used to be on this list and is not any more.**
`courier` **does ship an adapter** — `Swoosh.Adapters.SMTP`, the one adapter it
supports — and it is selected by `COURIER_MAIL_ADAPTER`. There is no provider
credential to rotate *until you configure one*, which is a deployment step rather
than a rotation, and it is [section 6](#6-an-email-provider-credential-in-courier--required-not-optional).
What remains true is narrower and worth saying precisely: **`courier` will not
start in production without it**, so a deployment that has never set it has never
run a production courier at all.

## What not to do

- **Do not rotate by replacing the single value.** Set the plural
  (`STRIPE_WEBHOOK_SECRETS`) or create the second role first. Replacing the only
  value and restarting turns a rotation into an outage.
- **Do not remove the old Stripe secret from Stripe and from `billing` at the
  same time.** One side signs, the other verifies; they must never disagree.
- **Do not attempt to rotate `MUSE_VAULT_KEY`.** There is no tooling, and it
  makes every stored credential undecryptable. Rotate the *provider* key inside
  the vault instead.
- **Do not attempt to rotate `COURIER_SECRET_BOX_KEY` or `MFA_ENCRYPTION_KEY`
  either**, and do not assume they are easier than the vault key because their
  columns look like ordinary data. Both are sealing keys with no re-seal
  tooling; `MFA_ENCRYPTION_KEY` additionally fails **closed**, so a bad rotation
  locks users out of their own second factor rather than degrading.
- **Do not set `COURIER_MAIL_ADAPTER=none` in production to get past a missing
  variable.** It is refused at startup for exactly that reason, and forcing it
  through config gives you a courier that reports every send as delivered and
  mails nobody.
- **Do not `DROP ROLE` before every service is on the new one.** The drop fails
  while grants depend on it, and you will be doing the `REASSIGN OWNED` dance
  with old credentials already revoked.
- **Do not assume a secret is picked up live.** Every service reads its
  environment at startup and never re-reads it. A changed value without a
  restart is a changed value that has had no effect.
- **Do not commit a generated key anywhere.** `muse.vault` prints to stdout and
  nothing else; that output is the only copy, and it goes straight into a secret
  manager.
- **Do not let `courier` boot without a mail adapter, and do not settle for a
  warning.** The refusal at boot is the control. A deployment that starts and
  accepts mail it cannot send is the failure that produced a green dashboard
  over undelivered password resets.
- **Do not rotate a scoped API token by deleting it first.** Two keys are valid
  at once; that is what makes this rotation the cheapest on the page. Deleting
  first removes the overlap and with it the reason there is no downtime.
- **Do not treat a missing `last_used_at` as "still in use".** The field is
  omitted for a key nobody has ever presented, which is the case you most want
  to notice and the one a dashboard counting non-null values will drop.

## A rotation schedule worth having

Not urgent — nothing here is a perishable credential — but a rotation nobody
schedules is a rotation that does not happen:

| Secret | Cadence | Trigger |
| --- | --- | --- |
| Stripe webhook secret | on Stripe's advice, or annually | any suspected disclosure |
| Stripe API key | on staff change, or annually | any suspected disclosure |
| LLM provider credentials | 90 days, or on provider notice | provider-side rotation, staff change |
| Database passwords | 90 days | any suspected disclosure |
| Object-storage credential | 90 days | any suspected disclosure |
| `COURIER_SMTP_PASSWORD` | 90 days, or on provider notice | staff change; **not** a cafaye-side key |
| Scoped API tokens (`identity`) | on the `expires_at` you issued, or on staff change | departure, a leaked CI variable, a decommissioned integration |
| `MUSE_VAULT_KEY` | **never** | not rotatable; replace the provider keys instead |
| `COURIER_SECRET_BOX_KEY` | **never** | not rotatable; re-sealing tooling does not exist |
| `MFA_ENCRYPTION_KEY` | **never** | not rotatable, and a lost key fails users **closed** |

## See also

- [Backup and restore](/runbooks/backup-and-restore/) — the vault key is what
  makes one of those dumps readable.
- [Tenant provisioning](/runbooks/tenant-provisioning/) — the credentials this
  creates.
- [Topology](/architecture/topology/) — every environment variable, in one
  table.
