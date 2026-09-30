---
title: parlor
description: The app shell — a production-ready frontend template plus the admin surface every cafaye product inherits.
---

`parlor` is the front door of every product built on cafaye: a Next.js app
shell — signup, login, MFA enrollment, dashboard, settings, team and invitation
UI — plus the admin surface they all inherit. It is **Next.js**, because it is
the web and nothing else needs to be.

:::caution[Status: in progress (Phase 2)]
The shell arrived first: routing, theme, health surfaces, and a test rig. The
auth screens followed, against a generated client for the `identity` contract
with a mocked transport underneath it. Settings, team/invitation management, the
admin surface, and the Playwright end-to-end suite are later packets. This is
not a finished template to clone today.
:::

`parlor` is a **template, not a platform dependency** — and that is the design
decision to understand before using it. You clone it, you read all of it, you
change what you need and ship your fork: no license key, no feature gate, no
call home, and no vendor who can raise your prices or pull the rug later.
Anything cafaye adds to the shell arrives as code in your repository, not as a
runtime dependency, and upstream improvements come back as a merge rather than a
migration. The test of whether that is real: if cafaye disappeared tomorrow, a
`parlor`-based product would keep shipping.

Because the browser reaches `identity` cross-origin, session handling is settled
in the repository rather than in the template — a BFF route owns the cookie
before it can be one. The Playwright suite (signup, login, MFA, invites,
checkout) is born here and runs nightly in CI.

- **Repository:** [github.com/cafaye/parlor](https://github.com/cafaye/parlor)
- **Language:** Next.js / TypeScript