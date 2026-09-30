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
widened by a token, plus an in-memory fixed-window rate limiter. **It routes
nothing yet.** The proxied surface is a later packet, so today it terminates
traffic and forwards none of it.
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

- **Repository:** [github.com/cafaye/guard](https://github.com/cafaye/guard)
- **Language:** TypeScript
- **Namespace / routing prefix:** `guard`