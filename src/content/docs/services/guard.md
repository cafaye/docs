---
title: guard
description: The public gateway and BFF — the only door in, terminating auth and rate limits in front of every service.
---

`guard` is the only door into a cafaye deployment. It authenticates callers,
limits what they may ask for, and forwards each request to the service that
actually owns the work — which is why it is written in **TypeScript** and sits
on the same runtime the web does. A browser-facing gateway and a Next.js frontend
sharing a language means one set of types for the tokens between them.

:::caution[Status: v0 — real auth, no routing yet]
v0 terminates real authentication: RS256 bearer tokens verified against
`identity`'s JWKS, with the accepted algorithm pinned in one constant and never
widened by a token, plus a browser BFF surface (`/auth/register`, `/auth/login`,
`/auth/logout`, `/auth/me`) and an in-memory fixed-window rate limiter. **It
routes nothing yet.** The proxied surface is a later packet, so today it
terminates traffic and forwards none of it; `/v1/me` exists to prove the auth
chain end to end and forwards nothing.

Two limitations that shape how you deploy it: **the session store and the
rate-limit counters are `Map`s in one process**, so a second replica cannot see
a session the first one created, and a client gets its allowance from each
replica separately. Run one replica until the shared stores land.
:::

Two behaviours are load-bearing and will not be relaxed. **The token never
chooses how it is checked** — the algorithm is pinned server-side and the
protected header is read before any key is fetched, so an `alg: none` or HS256
token costs no network call and never reaches a verifier. And **liveness never
touches a dependency**: `/healthz` is unconditional while only `/readyz` may
fail because something else is down, so a database or `identity` outage cannot
get the process restarted out from under in-flight requests. Both probes are
also exempt from rate limiting, because a throttled probe is an orchestrator
that cannot see a healthy process.

Two numbers to plan against. The fetched key set is cached for
`IDENTITY_JWKS_TTL_MS` (default 300000 — five minutes), and **that TTL is also
the revocation window**: a key `identity` withdraws keeps verifying until the
cache expires. And a failed key-set fetch is a `503`, not a `401`, so a platform
outage is never mistaken for a caller's expired token.

- **Repository:** [github.com/cafaye/guard](https://github.com/cafaye/guard)
- **Language:** TypeScript
- **Namespace / routing prefix:** `guard`
- **Environment:** `PORT`, `IDENTITY_ISSUER`, `IDENTITY_JWKS_URL`,
  `IDENTITY_JWKS_TTL_MS`, `GUARD_CLIENT_ID`, `IDENTITY_URL` — see
  [Topology](/architecture/topology/#environment-variables)