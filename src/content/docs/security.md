---
title: Security and trust
description: How cafaye handles credentials and secrets — encryption at rest, redaction in logs and traces, the secret scan in CI — with every claim pointing at the file that makes it, and the gaps named.
---

**Every claim on this page points at a file.** Where a claim is a decision rather
than code, the decision is named as a decision. Where a practice is specified but
not implemented, the page says so — that distinction is the whole reason
[Observability](/observability/) exists, and applying it here is the difference
between a trust page and a brochure.

Measured **2026-10-01** against `identity` and `muse` at their `master` tips,
`courier` at `master`, and `kit`'s reusable workflow. The paths below are
relative to each repository's root.

## Read this first: there is nothing of ours to breach

**You operate the deployment.** Your Postgres, your object-storage bucket, your
TLS terminator, your keys, your cloud account. There is no cafaye-operated
component in the stack, no cafaye account, and no cafaye-operated endpoint any
service talks to.

**By default, nothing leaves your infrastructure.** No service exports telemetry
unless you configure it, there is no licence check, no update check, and no
analytics in any of them. The four things that *will* egress, and only if you turn
them on, are [listed in one table](/pilot/#what-leaves-your-infrastructure):
presigned upload writes to a bucket you name, LLM provider requests to providers
whose keys you supply, Stripe calls in your Stripe account, and email delivery
once you configure an adapter.

`docs.cafaye.com` itself is static HTML with no analytics and no third-party
scripts. That is a decision recorded in this repository's configuration rather
than an oversight.

**What that does not mean.** "Nothing leaves" is a statement about the default
configuration, not a guarantee about every configuration. If you point
`<SERVICE>_OTEL_ENDPOINT` at a vendor, your spans go there. If you configure
`courier`'s email provider, your message content goes to it. The page below tells
you what each of those carries.

## Credentials at rest

**The pattern is the same in every service that stores one, and it is
authenticated encryption rather than a hash.** Three implementations, three
languages, one design:

| Service | What is sealed | Primitive | Key | Where |
| --- | --- | --- | --- | --- |
| `muse` | one LLM provider API key per row of `vault_secrets` | AES-256-GCM, provider name as additional authenticated data, fresh 12-byte nonce prepended per seal | `MUSE_VAULT_KEY`, 32 bytes, base64, from the environment | `src/muse/vault.py` |
| `courier` | every outbound webhook's signing secret | AES-256-GCM, AAD `courier:webhook-secret:v1`, nonce from `crypto/rand` on every seal | 32 bytes, base64, from configuration — **never from the database** | `lib/courier/secret_box.ex` |
| `identity` | every user's TOTP shared secret | AES-GCM, nonce from `crypto/rand`, AAD bound to the user id | `MFA_ENCRYPTION_KEY`, base64url, exactly 32 bytes, **never generated at boot** | `internal/mfa/vault.go` |

Three properties of that design are worth naming, because each is a decision
rather than a default:

- **No default key, and a wrong-length key is a startup failure.** `muse` refuses
  to start if `MUSE_VAULT_KEY` is unset, is not base64, or does not decode to
  exactly 32 bytes. A vault that boots with a fallback key is a vault whose keys
  are readable by anyone who has read the source.
- **The nonce is drawn fresh per seal and prepended to the ciphertext.** Reusing
  a nonce under one key destroys the confidentiality of both messages, and it is
  the one mistake with no symptom until it is far too late. `courier`'s module
  makes sealing the same secret twice produce different bytes a **test**, not an
  accident.
- **The AAD is not decoration.** `muse` binds the provider name and `identity`
  binds the user id, so a ciphertext copied from one row to another fails to open
  instead of decrypting under the wrong vendor or the wrong user.

**"Not plaintext at rest" has an exception you must plan for, and it is the key,
not the row.** A dump of `vault_secrets` or `mfa_secrets` is unreadable without
its key, and the key lives in your environment, not in the database. That is the
property you want and it has a consequence: **a backup of the rows is not a
backup of the secrets.** [Rotating
secrets](/runbooks/secret-rotation/#3-the-muse-vault-key--cannot-be-rotated) is
explicit that `MUSE_VAULT_KEY` cannot currently be rotated at all, and
[`OIDC_SIGNING_KEY`](/runbooks/secret-rotation/#5-the-identity-oidc-signing-key--configured-not-rotatable)
is configured but not rotatable either.

## Passwords, sessions and API keys in `identity`

`identity` is the security boundary, so its storage choices are the ones worth
reading twice. They split cleanly by whether the value is something a human
chose:

| Value | Stored as | Why | Where |
| --- | --- | --- | --- |
| A user's password | **argon2id** digest, `DefaultParams` | it is a human-chosen secret, so guessing is the attack and a memory-hard function is the defence | `internal/users/password.go` |
| A session token | SHA-256 hex digest | 256 bits of `crypto/rand` has no structure to guess; a memory-hard function would cost tens of milliseconds per request and buy nothing | `internal/sessions/token.go` |
| A scoped API key | SHA-256 hex digest, prefix included | the same argument, and hashing the whole value keeps the presented and stored shapes identical | `internal/apikeys/apikeys.go` |
| An MFA recovery code | SHA-256 hex digest | 80 bits of `crypto/rand`, same reasoning | `internal/mfa/recovery.go` |

**The invariant all four share: the presented value is never stored.** A dump of
`users`, `sessions`, `api_keys` or `mfa_recovery_codes` is not a set of
credentials. That is stated in the source next to each digest function rather
than inferred here.

Two properties `identity` holds that are easy to get wrong and are tested:

- **A non-member gets `404`, never `403`.** A `403` on an account would confirm
  that an id you guessed is real, which is a free tenant-enumeration oracle.
- **Redirect URIs are matched by equality, always.** The client-registration
  validator refuses a wildcard, so nothing in the service can become an open
  redirector for a product registered against it.

## Nothing about a credential reaches a log or a trace

Two separate mechanisms, because "we do not log secrets" in prose does not
survive a code change, and the fleet has tried.

### 1. A type that cannot print itself

`muse` wraps a credential in a `Secret` whose `repr` and `str` are the redaction
marker and never the value, and provides `redact()` to scrub a known secret out
of text that is about to be logged or returned. The value comes back from the
vault **as a `Secret`, never as a `str`** — returning a bare string at the one
place the value is born would undo every guarantee the type provides.

`tests/test_redaction.py` asserts the case that actually leaks in practice: a
`%s` in a log line, an f-string, a format spec (`f"{secret:>40}"` in an aligned
table), and a `Secret` printed as an element of a `dict` or a `list` by a
container's own `repr`.

### 2. An allowlist, not a scrub list

For telemetry the fleet specifies the **allowlist** rather than a set of things to
remove, and that specification is
[core's `redaction.schema.json`](https://github.com/cafaye/core/blob/master/schemas/telemetry/redaction.schema.json).
`muse` is an LLM gateway, so it is where a prompt would leak if anywhere would —
but it is **not** the only service the boundary applies to.
`courier`, `billing` and `identity` export traces too, and the boundary is
enforced **once, in the collector**, rather than trusted to each service's
discipline: `kit`'s collector config is derived from `core`'s schemas, and its
gate compares the two in both directions at gate time.

- **What may be recorded about an LLM call** is a fact about how it was served:
  which model, the token **counts**, the latency, the finish-reason class, and the
  routing decision. See [the redaction
  boundary](/observability/#the-redaction-boundary) for the attribute table.
- **What may never be recorded anywhere** is the prompt, the completion, message
  content, tool arguments, system instructions, the transcript, anything a caller
  typed, a credential, `error.message`, and a stack trace.
- **`tests/test_trace_propagation.py` holds this with a canary.** A unique string
  is placed in **both** the prompt and the completion the fake provider returns,
  the real application is driven end to end, and the assertion is on the
  **rendered span payload as one string** — every attribute of every span — so a
  leak through an attribute name nobody predicted is caught. It is asserted both
  ways: the canary appears nowhere, *and* no attribute name contains `prompt`,
  `message`, `content`, `text`, `body` or `header`.
- A second test covers the vendor's own error path: a provider that echoes your
  key back in its error text is scrubbed by the adapter, and the span records only
  `error.type`. Two independent barriers to one leak, on purpose.

:::caution["Never logged" is a mechanism, not a survey]
The redaction type is in `muse` because `muse` is the service that holds
third-party credentials and prompts. We are not claiming a fleet-wide audit of
every log statement in six languages; we are claiming that the two places where a
secret or a prompt is *born* have a type and a test that make an accidental print
impossible, and that `muse`'s own auth errors are written to name the failed
**check** rather than the token. If you need the stronger claim for a service
this page does not cover, ask for it and we will go and measure it.
:::

## Verification in CI

### The secret scan

`kit`'s reusable workflow has a **`secrets` job with no opt-in** — it is the one
job in that file that is not behind an input, on purpose, because it is the one
job a repository must not have to remember to ask for. It:

- checks out with `fetch-depth: 0`, so it scans **full history** rather than the
  diff. A secret committed and deleted in the same pull request is still in the
  history and still on somebody's fork; a shallow scan is blind to precisely the
  finding that matters;
- runs `gitleaks`, installed from a **pinned release with a sha256 the repository
  owns** — kit's own bootstrap, not a third-party action, so the version and the
  hash are one edit in a file we ship and the scanner cannot be swapped by a
  dependency bump;
- always passes **`--redact`**, and not optionally: a CI log is retained,
  searchable and often public, so the scanner finding a secret must never be why
  the secret is printed;
- **makes no network call.** gitleaks is a static binary that reads a repository
  and matches regexes. That is the whole reason it is gitleaks and not
  trufflehog, which would verify a live credential against its issuer — a scanner
  that can reach the internet is a scanner that can be made to exfiltrate;
- **has no dangerous trigger.** The reusable workflow declares no
  `pull_request_target`, and kit's own test fails if that string ever appears,
  because a job under that trigger is a credential-theft primitive waiting for a
  reason.

Files: `kit/.github/workflows/ci.reusable.yml`, `kit/tests/gitleaks_gate.sh`, and
`kit/tests/validate.sh`, which fails if a `.gitleaksignore` ever appears — there
is no inline allowlist.

**Ten of the fifteen repositories run it**, being every repository that calls
`cafaye/kit/.github/workflows/ci.reusable.yml@master`: `billing`, `caf`, `core`,
`courier`, `darkroom`, `guard`, `identity`, `kit`, `muse`, `parlor`.

**Five do not**, and saying so is the point of this section: `cafaye-py`,
`cafaye-rb`, `cafaye-ts`, `pantry`, and **`docs`, this repository**. `docs`
writes its own CI for three measured reasons, documented at length in its own
`pins` job; the cost is that it receives none of kit's fixes, and the
consequence for this page is that a secret scan is not one of the checks you can
read a badge for here.

### What identity checks about its own workflow

`identity` parses its own `ci.yml` in a test and fails if either
`MFA_ENCRYPTION_KEY` or `OIDC_SIGNING_KEY` is assigned a literal — an assignment
is a literal when its own word contains no `$` — and fails if the file carries a
PEM armour block or a 40+ character opaque run containing a digit. The
reasoning is in the test: **a key in a workflow is a key in a log**, and that is
invisible in review because it reads as configuration.

This repository's own CI has the equivalent check: it greps both of its workflows
for a secret reference or a credential shape and fails the build if one appears,
and it does so *deliberately bluntly* — adding a legitimate secret is supposed to
require deleting a line that says why.

## Known weaknesses and unbuilt controls

Stated because a trust page that lists only the good parts is a brochure.

:::caution[`MUSE_VAULT_KEY` and `OIDC_SIGNING_KEY` cannot be rotated today]
`MUSE_VAULT_KEY` has a `key_version` column that is always `1` and no tooling to
change it: **rotating it makes every stored credential undecryptable**, and the
only safe operation is a restore — dump, generate a new key, re-seal every row.

`OIDC_SIGNING_KEY` is different and worse in one respect: there is no overlap
window at all. Put the new key in the environment and the old one stops signing
immediately, which makes a rotation a **cutover**, so it has to be scheduled.
And withdrawing a compromised signing key does not take effect for up to
`IDENTITY_JWKS_TTL_MS` — **five minutes by default** — because `guard` holds a
fetched key set in memory for that long. That TTL is also the revocation window,
and it is stated in `guard`'s own README.

Full procedures and the two things not to do are in [rotating
secrets](/runbooks/secret-rotation/).
:::

**Not built, and a reader will hit it.**

- **Password reset and email verification exist in `identity` but are off until
  they are configured.** The five recovery paths are served and published in
  `identity/openapi/v1.yaml`, and `site` implements the flow. What is missing by
  default is the mailer: without `COURIER_BASE_URL`, `COURIER_TOKEN` and
  `PASSWORD_RESET_LINK_TEMPLATE`, `POST /v1/password-resets` answers **503**.
  The service is mounted deliberately rather than absent — a 404 would tell a
  client that password recovery does not exist here, which is false — so the
  honest reading of a 503 is "not configured yet", and it is still true that a
  deployment should have somebody on the other end of a support channel.
- **No refresh tokens.** Access tokens live fifteen minutes and cannot be
  renewed, and there is no end-session endpoint.
- **OIDC and MFA are not mounted by default.** `identity` requires all three of
  `OIDC_ISSUER`, `OIDC_SIGNING_KEY` and `OIDC_SIGNING_KEY_ID` to publish its
  discovery document, and `MFA_ENCRYPTION_KEY` to mount the MFA routes. Unset,
  the routes are **absent** rather than present-and-broken, and the process says
  so twice at startup. `caf dev` sets none of them.
- **`guard` forwards nothing and keeps sessions in one process's memory.** It
  serves `/v1/me` and `/auth/*` and routes no request onward; a browser session
  dies with the replica it signed in on. **Run one replica** until that changes.
- **No broker, so no event leakage — and no event delivery.** Nothing publishes
  off the outbox, which is good for a data-egress argument and bad for anything
  that expected a service to react to another.
- **Telemetry is instrumented but not deployed.** `courier`, `billing`,
  `identity` and `muse` export traces to whatever `<SERVICE>_OTEL_ENDPOINT`
  names, and **no collector is deployed in any environment**, so there is no
  egress to worry about *and* nowhere for a span to land. The stack that would
  receive them is shipped by `kit`, and its redaction boundary is enforced in
  the collector rather than trusted to each service.
  [Observability](/observability/) has the per-service table, and it is a
  different list from the one describing what is running.

**Coverage the CI does not have.**

- **No repository opts into `zizmor`**, the GitHub Actions security audit, so no
  repository in the fleet currently audits its own workflow shape.
- **No dependency-vulnerability scan in the shared workflow.** Three repositories
  check their own tree and nothing else does: `billing` (`bundler-audit`),
  `cafaye-py` (`pip-audit`), `cafaye-ts` (`npm audit`). The other twelve have
  none, because `kit`'s reusable workflow has no such step.
- **Only `billing` has `dependabot.yml`,** so it is also the only repository
  receiving automated dependency update pull requests.
- **There is no `SECURITY.md` in any of the fifteen repositories**, no published
  disclosure address, and no security.txt.

## One drift we found, recorded rather than papered over

The [hosted-pilot page](/pilot/#what-is-not-production-ready-yet) lists, as a
blocker, that **`muse` does not verify the token it is given** and that its auth
is a stub. **That was true when the page was written and it is not true of the
current source.** Measured on 2026-10-01 at `muse` `e3f53b0`: `muse` verifies the
bearer token against `identity`'s JWKS with the algorithm **pinned to `RS256` at
the decoder** rather than read from the token, requires `iss`, `aud`, `sub`,
`exp`, `iat`, `jti` and `account_id`, checks the operation's capability
separately from the signature, and **refuses a token carrying both authorisation
claim names where they disagree**. An unreachable key set is a `503`, never a
`401`, and **`muse` does not serve unauthenticated traffic when `identity` is
down** — the request is refused rather than admitted on an unverified credential.
`tests/test_auth.py` asserts the credential never reaches a log, a span, or an
error body, using a marker placed inside the token.

**This repository does not edit that page.** The hosted-pilot page is
commit-pinned to an earlier measurement and is, on its own terms, a dated
snapshot; the rule this site follows everywhere is that the code is right and a
stale sentence is a finding, not a thing to quietly rewrite. The finding is
recorded here and in this packet's report so the page's owner can re-measure it
in the same commit that pins it forward.

## Reporting a problem today

:::caution[There is no security contact, and that is a gap rather than a route]
No `SECURITY.md`, no `security@` address, and no `security.txt` exist in any
cafaye repository. Publishing an address on this page without a process behind it
would be a trust page describing a trust programme that does not exist, so the
honest answer is what does exist, and it is thinner than we would like.
:::

What exists now:

- **The repositories.** <https://github.com/cafaye> — every service's issues and
  history. A vulnerability in `identity` is a bug in `identity`, and the fastest
  honest route today is its issue tracker, where the maintainers actually watch.
- **A per-repository contact address**, declared in each `cafaye.yml` under
  `owner.contact`: `identity@cafaye.com`, `courier@cafaye.com`, `caf@cafaye.com`,
  `docs@cafaye.com`, and nine more. **Thirteen of the fifteen repositories
  declare one**; the two that do not are `kit` and `cafaye-py`, because they have
  no `cafaye.yml` at all.
- **A design-partner agreement**, which is where a response window and a
  disclosure process would be written down before any work started. See [the
  design-partner flow](/pilot/#the-design-partner-flow).

**Open questions for us, and the answers are not ours to give from a public
page:** who receives a report, what response time applies, whether a report is
confidential, whether there is a safe-harbour statement, and whether a
coordinated disclosure window exists.

## See also

- [Licensing](/licensing/) — what MIT permits a buyer to do, and the seven
  repositories that do not carry the grant yet.
- [Pricing](/pricing/) — what is free, what is sold, and which of the three paid
  products is in operation.
- [Rotating secrets](/runbooks/secret-rotation/) — the inventory, what can be
  rotated today, and the two that cannot.
- [Observability](/observability/) — the redaction boundary, the attribute
  allowlists, and what is specified against what is running.
- [identity](/services/identity/) · [courier](/services/courier/) —
  [muse](/services/muse/) — the services whose storage and redaction decisions
  this page cites.
- [Backup and restore](/runbooks/backup-and-restore/) — what a dump of the rows
  does and does not give you without the key.
