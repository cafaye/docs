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
| LLM **provider** credential (OpenAI, Anthropic) | `muse` vault | **yes, with no downtime** | re-seal the row |
| Database password (`DATABASE_URL`) | every service with a database | **yes, via a second role** | `CREATE ROLE` → cut over → `DROP ROLE` |
| Stripe **API** key | — | n/a | `billing` never calls Stripe. There is no key to hold. |
| `MUSE_VAULT_KEY` | `muse` | **no** | see [below](#the-vault-key-cannot-be-rotated) |
| `identity` token signing key | `identity` | **n/a yet** | identity publishes no JWKS; the OIDC provider is not built |
| Email provider credential | `courier` | **n/a yet** | `courier` is a v0 scaffold with no provider adapter |
| Session secret | `guard` | **n/a** | sessions are a `Map` in one process, signed by `identity` |

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

```json
{"status":"ok"}
{"status":"ok","deps":"postgres"}
```

`deps: "postgres"` is the check. If readiness says `deps: "none"`, the service
came up with **no database at all** — a typo in the DSN, or a missing
environment variable, and a symptom that looks nothing like a wrong password.

---

## 5. The identity token signing key — not built yet

`guard` verifies bearer tokens against identity's published JWKS at
`{IDENTITY_ISSUER}/.well-known/jwks.json`, and that mechanism is real. **The
key set is not**: `identity` has no OIDC provider and publishes no `.well-known`
endpoint, so there is no signing key to rotate.

The rotation procedure that will apply the moment it does exists, and it is
worth writing down now because two of its properties are non-obvious:

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

Order, when it lands:

1. Publish the new public key in identity's JWKS. Old key still published.
2. Wait longer than `IDENTITY_JWKS_TTL_MS` (5 minutes by default).
3. Mint tokens with the new key. Both keys verify.
4. After the longest token lifetime has passed (see below), remove the old public
   key and lower the TTL if you want the revocation to be immediate.

`guard` enforces **no ceiling on token lifetime** — it verifies `exp` and `nbf`
and trusts `identity` to mint short-lived ones. `core`'s conventions cap access
tokens at 15 minutes, and whether the edge enforces that is an open decision. So
"the longest token lifetime" above is whatever `identity` has been issuing, and
you should know the number before you need it.

---

## 6. Secrets that do not exist yet

Do not build a rotation procedure for these; there is nothing to rotate.

- **An email provider credential.** `courier` is a v0 scaffold — no Swoosh, no
  provider adapter, no job queue, no preference store. It sends nothing.
- **A Stripe API key.** `billing` receives from Stripe and never calls it. The
  `processor`, `processor_product_id`, and `processor_price_id` columns are
  stored and returned, and all three are null in practice.
- **A session secret in `guard`.** Sessions are a `Map` in one process and the
  session id is `identity`'s. Restarting `guard` loses them; there is no key
  material to rotate.
- **A darkroom object-storage credential.** `darkroom` is an empty repository.

## What not to do

- **Do not rotate by replacing the single value.** Set the plural
  (`STRIPE_WEBHOOK_SECRETS`) or create the second role first. Replacing the only
  value and restarting turns a rotation into an outage.
- **Do not remove the old Stripe secret from Stripe and from `billing` at the
  same time.** One side signs, the other verifies; they must never disagree.
- **Do not attempt to rotate `MUSE_VAULT_KEY`.** There is no tooling, and it
  makes every stored credential undecryptable. Rotate the *provider* key inside
  the vault instead.
- **Do not `DROP ROLE` before every service is on the new one.** The drop fails
  while grants depend on it, and you will be doing the `REASSIGN OWNED` dance
  with old credentials already revoked.
- **Do not assume a secret is picked up live.** Every service reads its
  environment at startup and never re-reads it. A changed value without a
  restart is a changed value that has had no effect.
- **Do not commit a generated key anywhere.** `muse.vault` prints to stdout and
  nothing else; that output is the only copy, and it goes straight into a secret
  manager.

## A rotation schedule worth having

Not urgent — nothing here is a perishable credential — but a rotation nobody
schedules is a rotation that does not happen:

| Secret | Cadence | Trigger |
| --- | --- | --- |
| Stripe webhook secret | on Stripe's advice, or annually | any suspected disclosure |
| LLM provider credentials | 90 days, or on provider notice | provider-side rotation, staff change |
| Database passwords | 90 days | any suspected disclosure |
| `MUSE_VAULT_KEY` | **never** | not rotatable; replace the provider keys instead |

## See also

- [Backup and restore](/runbooks/backup-and-restore/) — the vault key is what
  makes one of those dumps readable.
- [Tenant provisioning](/runbooks/tenant-provisioning/) — the credentials this
  creates.
- [Topology](/architecture/topology/) — every environment variable, in one
  table.
