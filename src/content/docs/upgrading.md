---
title: Upgrading
description: What changed in the contracts, what breaks in a running deployment, and the order to do the work in.
---

This page is for someone with a **running deployment** who is about to move to
the current `core` spec and the current service images.
It is not a changelog: a changelog tells you what happened, and this tells you
what to do on a Sunday afternoon with a customer waiting.

Nothing here is a plan. Every claim below was read out of a repository on
`master`, and where a repository disagrees with this page, the repository is
right and this page is a bug.

## Read this first: how urgent is any of it?

**No cafaye service starts an outbox publisher loop.**
`identity`'s only `Publisher` implementation is a deliberate no-op, and there is
no broker in the platform, so an event today is a row in `outbox_events` and
nothing else.

That has two consequences, and the second one is the reason this page exists:

- If you have **not** written your own publisher loop, then nothing is on a bus
  and none of the renames below can lose you an event. They are code changes
  you make before you need them, at whatever pace you like.
- If you **have** written one — which is the common case for a self-hoster who
  got this far — then events are flowing, the renames below are live traffic,
  and the ordering matters. Everything below is written for that reader.

## The order, and why it is that order

There is no order in which a consumer matching exactly one spelling of a courier
event type is correct across the cut. The old name and the new name never
overlap: courier published `email.delivered`, and it publishes
`courier.email.delivered`. Whichever side you move first, there is a window in
which the consumer matches nothing and events are silently dropped.

So the procedure is not "deploy A then B". It is **widen the consumer, then cut
the producer**:

| Step | What you change | What you verify |
| --- | --- | --- |
| 1 | **Record what you have.** The commit of every service you run, and the spec release your generated readers came from. | The list exists, in the same place as your backups. |
| 2 | **Widen every consumer** that matches a courier event type, so it accepts both spellings. Nothing is deployed as a rename. | Your match test has two cases and both pass. |
| 3 | **Deploy the new `courier`.** It publishes `courier.email.*` and `courier.notification.suppressed`. | Both spellings appear in the stream. |
| 4 | **Watch until the old spelling is at zero** for a full delivery cycle. | The old prefix has not appeared for a cycle. |
| 5 | **Narrow the consumer back to the new spelling.** | The consumer still matches. |

Step 2 is the one people skip, and skipping it is what turns a rename into a
silent gap. A consumer that matches only the new name stops delivering the
moment you deploy step 2 — because the running courier still publishes the old
one — and a consumer that matches only the old name stops delivering at step 3.
Both fail **quietly**: no error, no dropped-event counter, just a webhook
handler that stopped being called.

Steps 4 and 5 are what stop a temporary measure from becoming permanent. A
consumer that accepts both spellings is correct forever and useless for catching
a rename, which is the entire reason it is worth the extra week.

---

## 1. Courier's event types are now three segments

**What changed.** `core` froze the grammar as
`<service>.<entity>.<action>` — three segments, always prefixed with the
publishing service's own name, no exceptions. `courier` published two-segment
types, which fail that pattern. `courier` has been corrected:

| Was | Is now |
| --- | --- |
| `email.queued` | `courier.email.queued` |
| `email.delivered` | `courier.email.delivered` |
| `email.bounced` | `courier.email.bounced` |
| `email.complained` | `courier.email.complained` |
| `notification.suppressed` | `courier.notification.suppressed` |

**This changes the `type` on events already on the bus.**
Anything matching `email.delivered` — a subscription filter, a routing rule, a
log query, a dashboard panel, an SDK's generated constant, a hand-written
`switch` — has to change.

**What you must change.** Every string that matches a courier event type. Note
that only the `courier.*` types moved; no other service's types changed. Verify
rather than assume:

```sh
# before you cut: nothing in your tree matches the old spelling alone
grep -rn --include='*.rb' --include='*.ex' --include='*.go' --include='*.ts' --include='*.py' \
  -E "['\"](email|notification)\.(queued|delivered|bounced|complained|suppressed)['\"]" .
```

**Also update:** anything that asserts on the type, not just anything that
matches on it. A consumer that filters correctly but writes the type into its own
ledger will produce two rows for one message during the window in step 3.

**How you know you are done.** `caf contract lint` over the fleet is green for
`courier`:

```sh
cd cafaye && go run ./cmd/caf contract lint .
```

---

## 2. `billing.subscription.started` no longer declares cafaye-prefixed ids

**This is a breaking spec change, and it was made four days after v0.2 shipped.**
It is recorded as `D10` in
[core's DECISIONS.md](https://github.com/cafaye/core/blob/master/DECISIONS.md),
with the alternatives and the cost of flipping.

**What changed.** The v0.2 payload schema required three ids in cafaye's own
vocabulary:

```
subscription_id   ^sub_[0-9A-Z]{26}$
plan_id           ^pln_[0-9A-Z]{26}$
account_id        ^acc_[0-9A-Z]{26}$
```

Those patterns describe a world in which `billing` holds cafaye-prefixed ids.
It does not: `billing` emitted the payment processor's ids and its own bare
uuids. A schema that names a field no publisher sends is worse than no schema,
because it is a contract that lies and it lies **green** — the example validates,
the suite passes, and every real event fails.

So the schema was rewritten to describe what `billing` actually emits, and every
billing payload now carries `processor` and `processor_event_id` so a consumer can
tell **a fact billing knows** from **a fact billing was told**.

**Why it is a decision and not a fait accompli.** The alternative — keeping
v0.2's text and treating the mismatch as `billing`'s debt — would have left a
schema no publisher satisfies. The recommendation on record is the rewrite,
with `billing` told plainly that the consumer obligation is a **regenerated
reader**.

:::caution[Do not regenerate your `billing` subscription reader yet]
`billing` has since grown a subscriptions table and moved those three events onto
its **own** ids. `billing` therefore emits a payload that core's rewritten schema
also rejects, and `billing`'s own contract test says so out loud rather than
absorbing it:

- **missing** against core's schema: `processor`, `processor_event_id`, `kind`,
  `customer_id`
- **rejected** by it (`additionalProperties: false`): `plan_id`, `account_id`,
  `currency`, `started_at`
- the same applies to `billing.subscription.updated` and
  `billing.subscription.canceled`, and `billing.plan.created` / `.updated` are
  missing `entitlements`.

There is therefore **no schema you can generate a correct reader from today** for
the five `billing` subscription and plan types. A reader generated from v0.2
rejects the real payload on `subscription_id`; a reader generated from current
`core` rejects it on four missing and four unexpected fields.

**What to do:** pin your generated reader for those five types where it is, and
treat `data` for them as **unvalidated** until core's schemas move. This is
`> DECISION NEEDED` in this site's report; the fix is one decision and one file
rewrite in `core`, and it is not yours to make.

The other nine `billing` types are unaffected. `billing.customer.created`,
`billing.payment.succeeded`, `billing.payment.failed`, `billing.plan.*` aside from
`entitlements`, and `billing.subscription.*` aside from the id shape, all
validate.
:::

**What you must change, when the schema settles.** Regenerate. A hand-written
reader that pattern-matches `sub_`/`pln_`/`acc_` is wrong in two directions: it
rejects real events today, and it will reject them after the fix too, because the
fix removes the patterns rather than widening them.

---

## 3. `billing.payment.succeeded` has two payload shapes

**What changed.** `billing` emits this event from two sources: an invoice-backed
payment and a one-time Checkout payment. They do not carry the same fields, so
the schema declares them as a `oneOf` with **exactly one** branch present:

| Shape | Present |
| --- | --- |
| invoice-backed | `invoice_id` **and** `subscription_id` |
| Checkout-backed | `checkout_session_id` |

This is not a nicety. A flat schema with every field optional would validate
both shapes while being unable to tell them apart, and `invoice_id` is `null`
for a one-off invoice — so "absent" and "present but null" are different
questions and a consumer has to get both right.

**What you must change.** If your consumer reads `invoice_id` off
`billing.payment.succeeded` and assumes it is there, it now has to decide which
shape it is looking at. The honest test is which branch is satisfied, not
whether a field is null. The invoice-backed branch:

```json
{ "invoice_id": "in_…", "subscription_id": "sub_…" }
```

And the Checkout-backed branch, which has no `invoice_id` at all:

```json
{ "checkout_session_id": "cs_…" }
```

**Why this matters before you notice it.** One charge can produce both events —
a Checkout session settles, and the invoice it creates settles too. `billing`
deliberately ignores a **subscription-mode** Checkout session, because it
restates `customer.subscription.created` and acting on both would count every
signup twice. A **one-time** Checkout payment is not ignored, and a consumer
that counts settled payments has to expect an invoice and a Checkout event for
the same money. Whether that is a double-count is a decision about your consumer,
and it is a real one.

---

## 4. Every event type now owes five things

An event type is conformant when **all five** exist. A publisher that has done
four is not conformant, and `caf contract lint` will say so once it enforces the
catalog direction:

1. The type in the publisher's `cafaye.yml` `exposes.events`, in the
   three-segment form.
2. A **catalog row** in
   [core's event naming document](https://github.com/cafaye/core/blob/master/docs/event-naming.md),
   with the subject and when it is emitted.
3. A **payload schema** at
   `schemas/events/<service>/<entity>/<action>.schema.json` — the event type
   with dots turned into directory separators.
4. A **valid example** and a **negative example** for that schema.
5. A **contract test**: the emitted envelope validates against the envelope
   schema, and the payload validates against the payload schema.

Steps 2 and 3 are the same fact stated twice, and `core`'s suite asserts they
agree in both directions — so land them in one commit.

**What you must change.** Nothing today; there is no publisher-side work for a
self-hoster running services rather than writing one. It is here because it is
the rule your consumer's generated code is being built against, and because a
type that fails one of the five is a type whose schema is not a promise.

---

## What is *not* breaking, and will still surprise you

These are not changes. They are things a reader upgrading from the v0.2-era docs
may have written down, and they are all still true.

**No service starts an outbox publisher loop.** Still true.
`unpublished: t` on every row of `outbox_events` is expected, not a fault.
Starting `identity`'s no-op publisher loop would mark events published and drain
the outbox into nowhere — strictly worse than a visible backlog.

**There is no event broker.** `core` specifies NATS as the transport and the
transactional outbox as the discipline; the discipline is implemented, the
transport is not deployed by anything in the platform.

**Delivery is at-least-once**, so dedupe on the envelope `id` with a unique
constraint in the same transaction as your work. An in-memory "have I seen this?"
set is wrong the moment you run two replicas.

**Ordering is per-`subject`, never global.** Correlate on `subject` and compare
`time`.

**`caf gen`, `caf init` and `caf new` are still flags-only** — they parse, check
their argument count, and return `not implemented in v0`. `caf dev` now does real
work; see [Getting
started](/getting-started/#step-5--run-a-service-locally). `caf deploy` and
`caf mcp` also do real work and are covered under Step 6.

## Verify, then close

```sh
# 1. every manifest in your tree validates
cd cafaye && go run ./cmd/caf contract lint .

# 2. your tree has no surviving reference to courier's old spellings
grep -rn -E "['\"](email|notification)\.(queued|delivered|bounced|complained|suppressed)['\"]" .

# 3. your generated readers are the ones you expect
#    — and for the five billing subscription/plan types, see the caution above
```

## See also

- [Contracts](/contracts/) — the manifest, the envelope, and where the specs live.
- [Topology](/architecture/topology/) — what is wired, what is not.
- [Troubleshooting](/troubleshooting/) — keyed by the symptom you can see.
