---
title: courier
description: Transactional email, push notifications, and every outbound webhook — signed, retried, at-least-once.
---

`courier` is the service the platform talks *out* through: transactional email,
push notifications, and **every outbound webhook** — so it carries the
Standard Webhooks spec exactly (a `webhook-id`, a timestamp, and an
HMAC-SHA256 signature header, no custom scheme of our own). It is written in
**Elixir** because fanning out to thousands of providers concurrently is exactly
what the BEAM is for.

:::caution[Status: v0 scaffold]
A working, deployable service with probes, a release image, and a local stack —
and deliberately **no notification logic yet**. There is no Swoosh, no provider
adapter, no job queue, no preference store, and no migrations.

**Nothing sends an email.** The practical consequence for an operator: the
invitation token from
[tenant provisioning](/runbooks/tenant-provisioning/) is returned in the API
response and has to be delivered by hand. The five event types it will publish
(`courier.email.queued`, `courier.email.delivered`, `courier.email.bounced`,
`courier.email.complained`, `courier.notification.suppressed`) are declared in
its manifest as a checklist, and its manifest is currently the one that fails
`caf contract lint` over the two-segment versus three-segment spelling — see
[manifest drift](/architecture/topology/#manifest-drift-you-may-hit).
:::

Delivery is **at-least-once**, which makes idempotency the consumer's problem
rather than the sender's: `courier` is expected to deliver the same email twice
under a failure, and every consumer of its events has to tolerate that.
Verification uses the official Standard Webhooks libraries rather than a
hand-rolled check.

- **Repository:** [github.com/cafaye/courier](https://github.com/cafaye/courier)
- **Language:** Elixir
- **Namespace / event source:** `courier`