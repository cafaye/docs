---
title: Licensing
description: MIT across the fleet, what that means for a buyer, and the measured state of the grant in each repository — including the seven that do not carry one yet.
---

**The decision: the whole fleet is MIT.** Every repository, including the three
you can [buy a unit of](/pricing/), is MIT licensed. There is no source gating,
no paid code, and no licence a buyer has to sign to use a service commercially.

**The state of the grant: seven of the fifteen repositories do not carry a
licence at all yet**, and one carries a different one. Both halves of that
sentence are load-bearing and the second half is the one that matters to you, so
this page states the decision and then states the gap rather than letting the
decision stand in for it.

The table is [below](#what-each-repository-declares-today), and it is a
measurement, not a recollection: it was re-derived on **2026-10-01** by reading
each repository's own committed files, and the command that does it is
[published at the end](#re-derive-it-yourself) so you can re-run it. A licence
table copied from the last page that quoted one is a changelog with a table in
it.

:::caution[This page measures committed `master`, and that is a choice]
Every row below was read with `git show HEAD:`, not out of a working tree. The
difference is not academic: **a licence grant is being landed across the fleet
right now**, and in a checkout with uncommitted work on it the answer is
different from the answer on `master`. A reader evaluating a licence needs the
answer for the commit they would actually depend on, and that is the committed
one.

So: if you clone today and see a `LICENSE` this page says is missing, the page is
behind and the repository is right — [re-run the
command](#re-derive-it-yourself) and believe the repository. When the grant
lands on `master`, this table changes in the same commit.
:::

## What MIT means for you, as a buyer

MIT is the shortest permissive licence there is, and it is short enough to
quote in full — which is the point of it, and a fair thing to expect of a
licence this permissive.

You may:

- **Use** it, commercially or not, for any purpose including a product you sell.
- **Modify** it, privately or publicly, without asking and without telling us.
- **Redistribute** it, in source or binary form, as part of something you ship.
- **Sell** what you built with it. There is no revenue share, no per-seat fee
  attached to the licence, and no clause that reaches your own product.
- **Sublicense** it under more permissive terms, and keep your additions under
  whatever you like.

You must:

- **Keep the copyright notice and the licence text** in every copy, including
  inside a binary you redistribute. That is the whole of attribution under MIT.
  There is no requirement to link back, to display a badge, or to say where a
  component came from in your UI.
- **Keep the warranty disclaimer** with it. The code is provided "as is".

There is no clause about:

- **Support.** A licence grants no obligation from anyone to answer your email,
  fix a bug, or keep working on it. That is a separate arrangement, priced
  separately — see [support](/pricing/#support) — and buying it does not change
  the licence.
- **A patent grant.** MIT has no explicit patent clause. Read the text; if that
  matters to you, ask, and get the answer in writing.
- **Trademark.** MIT does not grant you the right to use the cafaye name or
  marks. Do not present a fork as cafaye.
- **Any warranty at all**, including that the code is fit for a purpose, secure,
  or free of defects. It is not, and no page on this site says it is.

**The commercial model follows from this rather than sitting beside it.** We sell
[managed hosting, upgrades, and support](/pricing/), none of which is a licence
fee and none of which changes what the licence permits. `parlor` is free
permanently. The thing you are buying is engineering, and the code is MIT
either way.

## What each repository declares today

Measured **2026-10-01** across all fifteen cafaye repositories, from committed
`master` in each. "Nothing" is not a synonym for MIT — see the row below the
table.

| Repository | What it declares |
| --- | --- |
| [`cafaye-py`](https://github.com/cafaye/cafaye-py) | **`LICENSE`, MIT**, "Copyright (c) 2026 cafaye" |
| [`cafaye-rb`](https://github.com/cafaye/cafaye-rb) | **`LICENSE.txt`, MIT**, "Copyright (c) 2026 cafaye" |
| [`cafaye-ts`](https://github.com/cafaye/cafaye-ts) | **`LICENSE`, MIT**, "Copyright (c) 2026 cafaye" |
| [`darkroom`](https://github.com/cafaye/darkroom) · [`pantry`](https://github.com/cafaye/pantry) | `license = "MIT"` in `Cargo.toml`. No licence file. |
| [`guard`](https://github.com/cafaye/guard) · `docs` | `"license": "MIT"` in `package.json`. No licence file. |
| [`muse`](https://github.com/cafaye/muse) | **`license = { text = "AGPL-3.0-only" }` in `pyproject.toml`, and a README that says the same** |
| `identity` · `billing` · `courier` · `parlor` · [`core`](https://github.com/cafaye/core) · [`caf`](https://github.com/cafaye/caf) · [`kit`](https://github.com/cafaye/kit) | **nothing.** No licence file, no field in any manifest. |

### What "nothing" means, precisely

This is the row that decides whether you can build on a repository today, so it
is worth being exact rather than reassuring.

**GitHub's default licence for a public repository with no licence file is
"all rights reserved".** The code is readable. Readable is not the same as
licensed. Absent a grant, the default copyright position applies: the copyright
holder reserves all rights, and nobody else has permission to do anything with
it — including commercially, and including the thing the decision above says we
intend.

We do not think that is the intent. It is not what we are offering. But **an
intent is not a grant**, and a legal department at your company is right to read
the repository rather than the marketing page. So:

- **For `cafaye-py`, `cafaye-rb`, and `cafaye-ts`, the MIT grant is written down**
  and you can rely on it today.
- **For `darkroom`, `pantry`, `guard`, and `docs`, an MIT identifier is declared
  in a manifest.** That is a clear statement of intent from the copyright
  holder, and it is what the ecosystem's tooling reads. The full text is not in
  the tree.
- **For `identity`, `billing`, `courier`, `parlor`, `core`, `caf`, and `kit`,
  there is nothing at all.** **Do not self-host these on a commercial assumption
  without a written answer from us.** Ask, and get the grant in writing, before
  you build. We would rather have that conversation on day one than discover an
  absent grant in month two.

**The units you can buy are `identity`, `courier`, and the platform (`caf` +
`kit`) — and all three are in the "nothing" row.** That is not an accident of
this page's ordering; it is the gap, and it is the first thing on the work list
below. It is also the single most likely reason a purchase would be held up
inside your own legal review, so it is worth raising with us before you raise it
with them.

### `muse` is AGPL-3.0-only, and it is the only copyleft in the fleet

`muse` is the LLM gateway: it holds provider credentials and routes completions.
It declares **AGPL-3.0-only**, in its `pyproject.toml` and in its own README, and
that is a different licence from the one the rest of the platform is heading
towards. It is not a purchasable unit, and you are not being asked to buy it.

If you run `muse` anyway, AGPL's section 13 is the part that matters: **modify
it, run it as a service others reach over a network, and you must offer those
users your modified source.** That may be exactly right for an LLM gateway, and
it is a decision somebody made deliberately rather than a default. It is also
incompatible with putting a modified `muse` inside a closed-source product, which
is the arrangement most buyers here have in mind.

**What is not going to happen is a silent change.** Whether `muse` moves to MIT
with the fleet or stays AGPL-3.0-only with a stated reason is a decision for the
people who own it, and this page does not get a vote on it. What this page
commits to is narrower and is the part a reader can hold us to: **any change to a
licence lands in the same commit as this table, with the commit named, and is
announced** — not left for you to discover by diffing a `pyproject.toml`. If you
re-run [the command](#re-derive-it-yourself) and get a different answer from the
table, that is a bug in this page and the repository is right.

## The work that closes this gap

Not a plan with dates attached — a list of specific files, so that when the
grant lands you can see that it landed.

1. **A `LICENSE` file at the root of all fifteen repositories**, MIT, with
   "Copyright (c) 2026 cafaye" — matching the three that already have one.
   That single step takes **seven** repositories from "no grant" to "grant", and
   it is most of the blocker.
2. **A decision on `muse`, written down.** Either it moves to MIT with the
   fleet, or it stays AGPL-3.0-only with a stated reason in its own README. Both
   are defensible; leaving it ambiguous in a `pyproject.toml` is not. **A change
   here is expected and may already be in flight** — see the
   [caution at the top](#this-page-measures-committed-master-and-that-is-a-choice)
   for why this page measures committed `master` rather than a working tree.
3. **A `license` field in every manifest**, so the identifier is machine-readable
   by the tooling that already reads `cafaye.yml` and not only by a human
   reading a file listing.
4. **`caf contract lint` checking it**, once core's manifest schema has a field
   for it — so a repository that drops its licence is a red build rather than a
   drift nobody notices. That is a change to `core`, and `core` is
   manager-owned.
5. **A `SECURITY.md` and a disclosure address** in each repository. Related, and
   [not done either](/security/#reporting-a-problem-today) — a licence tells you
   what you may do; it does not tell you where to report a bug.

## Re-derive it yourself

A licence table on a documentation site is exactly the kind of claim that goes
stale silently, so here is the check. It reads **committed `master`** in each
repository rather than the files on disk, it makes no network call, and it
covers the same fifteen repositories the organisation publishes:

```sh
for repo in billing caf cafaye-py cafaye-rb cafaye-ts core courier darkroom \
            docs guard identity kit muse pantry parlor; do
  file=none
  for name in LICENSE LICENSE.txt; do
    git -C "$repo" show "HEAD:$name" >/dev/null 2>&1 && file=$name && break
  done
  field=$(git -C "$repo" show HEAD:package.json 2>/dev/null |
            grep -oE '"license"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1)
  for manifest in pyproject.toml Cargo.toml; do
    field=$field$(git -C "$repo" show "HEAD:$manifest" 2>/dev/null |
                    grep -oE '^license[[:space:]]*=.*' | head -1)
  done
  printf '%-12s %-14s %s\n' "$repo" "$file" "${field:-no field}"
done
```

`git show HEAD:` rather than `ls`, and that is the load-bearing word: a working
tree answers a different question from the one a buyer has, and answering the
working-tree question is how a documentation page ends up reporting somebody
else's uncommitted work as a shipped fact.

Run it against fresh clones of the organisation and the table above is what it
prints. **If the two disagree, the code is right and this page is the bug** —
which is the rule this repository follows everywhere, including for the
[drift audit](/architecture/topology/#cross-repo-drift-audit) and for
[status lines](/services/).

## See also

- [Pricing](/pricing/) — what is free, what is sold, and which of the three paid
  products exists.
- [Security and trust](/security/) — how credentials and secrets are handled,
  and the practices a buyer is buying into.
- [Hosted pilot onboarding](/pilot/#the-licence--read-this-one) — the same
  licensing position as the hosted-pilot page states it, commit-pinned to an
  earlier measurement.
- [Services](/services/) — one page per service, each stating what is built and
  what is not.
- [The cafaye organisation](https://github.com/cafaye) — the repositories
  themselves, which are the only authority on any of this.
