---
title: guard
description: The public gateway and BFF — the only door in, terminating auth and rate limits in front of every service.
---

`guard` is the only door into a cafaye deployment. It authenticates callers,
limits what they may ask for, and forwards each request to the service that
actually owns the work — which is why it is written in **TypeScript** and sits on
the same runtime the web does. A browser-facing gateway and a Next.js frontend
sharing a language means one set of types for the tokens between them.

:::caution[Status: v0 — real auth, API keys, distributed rate limits, no routing yet]
v0 terminates real authentication: RS256 bearer tokens verified against
`identity`'s JWKS with the accepted algorithm pinned in one constant, a browser
BFF surface, **scoped revocable API keys**, and a **sliding-window (GCRA) rate
limiter that runs against Redis when `REDIS_URL` names a shared store**. **It
routes nothing yet.** `/v1/me` proves the auth chain end to end and forwards
nothing; the proxied surface is a later packet.

**Sessions are still per process.** The limiter is shared when `REDIS_URL` is set;
the browser session store is **not** — it is a `Map` in one process, so a second
replica cannot see a session the first created, and a restart loses it. Run one
replica until the shared session store lands, or expect the
[login loop](/troubleshooting/#login-loops-back-to-the-sign-in-page).
:::

## Two behaviours that are load-bearing and will not be relaxed

**The token never chooses how it is checked.** The algorithm is pinned server-side
and the protected header is read **before any key is fetched**, so an `alg: none`
or HS256 token costs no network call and never reaches a verifier.

**Liveness never touches a dependency.** `/healthz` is unconditional while only
`/readyz` may fail because something else is down, so a database or `identity`
outage cannot get the process restarted out from under in-flight requests. **Both
probes are also exempt from rate limiting**, because a throttled probe is an
orchestrator that cannot see a healthy process.

## Rate limiting

The limiter is a **sliding window (GCRA)** counting in **one atomic step**, rather
than a fixed window that gives every client its full allowance at the boundary and
therefore permits a burst of twice the limit across it. GCRA spends the allowance
continuously, so two requests two milliseconds apart cannot both be admitted at
the end of an exhausted bucket.

There is a **per-route limit table**: `guard-api`, `guard-auth`,
`guard-auth-register`, `guard-auth-login`, `guard-auth-logout`. The probes are
not in it, deliberately.

**What is shared and what is not, exactly:**

| | Default (unset `REDIS_URL`) | With `REDIS_URL` |
| --- | --- | --- |
| Rate-limit counters | one process's memory | Redis, one GCRA Lua script — shared by every replica, survives restart |
| Sessions | one process's memory, **always** | one process's memory, **always** |

Set `REDIS_URL` and the counters are shared; without it, every replica grants its
own allowance and every restart resets them. `REDIS_URL=redis//redis` is refused
at startup, and a malformed value is an error rather than a silent default. The
connection is opened on first use, and Redis is a **registered readiness
dependency**, so `/readyz` reports `{"deps":{"identity":"ok","redis":"unavailable"}}`
rather than failing every request.

:::caution[The Redis path is reviewed, not executed]
The suite drives the Redis branch through a **line-for-line transcription** of the
Lua script rather than a live `redis-server`; running the real script against a
real Redis is a TODO in that repository. The in-process path and the Redis path
are asserted against **one shared behaviour table**, so the two cannot drift —
but neither is proof that the script behaves on a real server.
:::

## Two numbers to plan against

The fetched key set is cached for `IDENTITY_JWKS_TTL_MS` (default 300000 — five
minutes), and **that TTL is also the revocation window**: a key `identity`
withdraws keeps verifying until the cache expires.

**A failed key-set fetch is a `503`, not a `401`**, so a platform outage is never
mistaken for a caller's expired token and sends them to re-authenticate against a
healthy service.

## API keys

A script can hold a scoped, revocable API key rather than a bearer JWT. Keys are
revocable immediately — no TTL to wait out — and carry their own scope, so
`/v1/*` accepts a key where it would otherwise require a token.

- **Repository:** [github.com/cafaye/guard](https://github.com/cafaye/guard)
- **Language:** TypeScript (Bun)
- **Namespace / routing prefix:** `guard`
- **Container port:** 8080
- **Environment:** `PORT`, `IDENTITY_ISSUER`, `IDENTITY_JWKS_URL`,
  `IDENTITY_JWKS_TTL_MS`, `GUARD_CLIENT_ID`, `IDENTITY_URL`, `REDIS_URL`,
  `REDIS_PREFIX` — see [Topology](/architecture/topology/#guard)
