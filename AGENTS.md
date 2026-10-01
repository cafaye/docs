# AGENTS.md — working in `cafaye/docs`

Read this before changing anything here. The house rules in `moon/PLAN.md` §1
and §3 apply on top of it. **Never push. Never create a remote.** Work on
`worker/<packet-id>`; the manager merges to `master`.

## What this repository is

`docs`, the cafaye documentation site — docs.cafaye.com. It is a **static
Astro site with Starlight**: Markdown in `src/content/docs/`, HTML out of
`dist/`. There is no runtime, no server, no database, and no request handler
that anyone here maintains.

That fact drives every rule below. This repository has almost no ways to break,
which means the ways it *can* break are quiet: a broken link, a page that
vanishes from the sidebar, a build that has silently stopped producing output.
The gate is shaped around those, not around code coverage.

## The gate

**`bin/prime` must be green before any commit.** It is `npm ci && npm run build
&& npm test`, and `npm test` is the whole offline suite. There is nothing else
to run in the default tier.

```sh
mise install          # node 22.19.0, pinned in mise.toml
bin/prime             # or: mise run prime
```

- `npm run build` **is** half the gate. Starlight validates every page's
  frontmatter, Astro checks every content collection, and Starlight resolves
  every sidebar slug — so a red build is a real test failure, not a formality.
- `tests/smoke.mjs` asserts what the build does not: that the build produced the
  pages the sidebar promises, that **every page on disk is reachable from the
  sidebar**, that **every internal link in the built site resolves**, that **no
  built page contains an empty `<svg>`**, and that the services directory is not
  empty.
- `tests/links.mjs` asserts the link half the build never touches: that **every
  `#fragment` names a heading that exists** on the page it points at, that every
  internal link names a page that was built, that every configured redirect
  resolves and shadows nothing, and that every external href is a well-formed
  `https:` URL with a real host and no placeholder. **Offline.** The
  fragment check is the one that was missing and it is the one that finds real
  defects — see the history below.
- `tests/examples.mjs` asserts the code examples: every ` ```sh ` fence parses
  under `bash -n`, every ` ```json ` fence is valid JSON, every ` ```yaml `
  fence is a manifest, and every `caf` invocation in a fence names a subcommand
  the `caf help` output **quoted in `getting-started.md`** lists. That last one
  reads its vocabulary out of the repository's own prose rather than from a list
  written beside it, so there is one place that says what `caf` can do.
- The counts are printed, because a check that reports nothing looks like a
  check that found nothing: 111 shell fences, 12 JSON fences, 2 manifests, 6
  `caf` subcommands, 69 external links, 0 redirects. Measured on this branch by
  running the suite; this sentence said 103 and 50, which is the failure it
  exists to prevent, in the file that states it.

### The contract tier

**`bin/prime --contracts`** (or `mise run prime:contracts`) adds
`tests/contracts.mjs`, which is the only tier that can catch an example
contradicting something that has actually shipped:

- every `cafaye.yml` example in the docs goes through the **real
  `caf contract lint`**, against core's real manifest schema — and so does this
  repository's own `cafaye.yml`, because `getting-started.md` tells a reader to
  trust that tool;
- every event type a page says a service **declares or emits** has a catalog row
  in core's `event-naming.md`;
- every span name in `observability.md` obeys core's
  `schemas/telemetry/span-naming.schema.json` — the recommended ones must match
  its pattern and the "never" examples must not;
- the per-service telemetry table on `observability.md` agrees with core's
  `fleet.yml`, in both directions, and no page claims one service is the only
  one exporting telemetry while core records four. That last one is the
  sentence this site carried on three pages and core carried in a `notes`
  field; both were true once and neither had anything to stop it going stale
  again.

It needs a readable `core` (`CORE_PATH`, or a sibling checkout) and a `caf`
binary (`CAF`, or on `PATH`). It is a flag and a separate file rather than a
skip, because **a contract check that cannot find the contract is worse than no
contract check**: it converts an unknown into a green badge. Both prerequisites
are asserted, and their absence is a **failure with a message**, never a skipped
test.

### What a red here means

| Red | What it means | What to do |
| --- | --- | --- |
| build | frontmatter or a content collection is wrong | fix the page |
| a link or a fragment | a page or a heading was renamed and inbound links were not updated | fix the link. **Never** add the slug to an allowlist |
| a fence | the example is wrong, not the page | fix the example. If the **contract** is wrong, that is a finding for another repository |
| an event type or a span name | core moved and this site did not | fix the prose, or open a finding against `core` |
| the suite count | a test was added or removed | raise `BASELINE_TESTS` in `.github/workflows/ci.yml` **in the same commit**. Lowering it is not a way to get to green |

**A red link check is a real failure and not a flaky test to be retried.** There
are no sleeps and no retries anywhere in this gate, and adding one is how a
link checker gets made green during the outage it exists to catch.

### Things not to do to get to green

- Do not widen the placeholder substitution list in `tests/examples.mjs` to
  swallow a broken fence. Add a placeholder there **with a reason**, or write
  the example so `bash` can parse it. There is a test asserting the list is
  still the one this repository uses.
- Do not add a `DRIFT_SECTION` heading to the filter in `tests/contracts.mjs` to
  stop it flagging a row. That filter is what keeps the drift tables — whose job
  is to record types core does *not* publish — out of a check about what it does
  publish.
- Do not make a check skip. Every test in the offline tier is unconditional by
  construction, and CI fails the build on a single skip.

## CI

`.github/workflows/ci.yml` has three jobs and **the job names are the claims** —
a green tick over unnamed steps is a green tick over an unknown amount of work.

| job | what it is |
|-----|------------|
| `gate` | THE gate. `bin/prime` on the pinned interpreter, plus the suite-size guard and the tree-clean guard. |
| `contracts` | The tier the gate cannot run alone: a checkout of `core`, a `caf` built from source, and `bin/prime --contracts`. |
| `pins` | The configuration claims. No toolchain, no build, no network, so it fails in seconds. |

`.github/workflows/external-links.yml` is the network tier and is **deliberately
a separate file**: it never runs on a pull request, because a link that will not
answer is a red build on a contributor's change that did not cause it.

Four things about this CI that are not obvious and that the file argues in full:

- **This repository does not call kit's reusable workflow, and the three reasons
  are measured, not remembered.** kit's `node` job has no build step and this
  repository's suite reads `dist/` (`npm ci && npm test` on a fresh clone is 3
  pass / 4 fail); it runs `npm run lint` unconditionally and this repository has
  no linter; and kit's `none` job would run the gate on the runner's node rather
  than the pinned one. The cost is that **this repository receives none of kit's
  fixes** until someone ports them. The `pins` job asserts the reason is still
  written down, and that a future `uses:` line is the documented
  `cafaye/kit/.github/workflows/ci.reusable.yml@master` rather than the stale
  `workflows/` form that resolves to nothing.
- **`node --test`'s summary is parsed by name, not by field position.** The
  first version used one `read` over the whole line; the line begins with `#`, so
  every offset shifted and the guard reported a skip on a fully green run. Four
  greps that each name what they want are not a bet on the reporter's field
  order.
- **The pipeline is bash and captures the gate's own exit code with
  `${PIPESTATUS[0]}`.** Under zsh there is no `PIPESTATUS`, so a piped exit code
  is the exit code of `tail`, which is always zero. That has already produced
  one false green in this fleet.
- **The suite size is held by equality, not as a floor.** `16 tests, 0 skipped`
  is the number measured on this branch. A floor would accept a suite that lost
  `tests/links.mjs` and `tests/examples.mjs` entirely — which is the whole
  deliverable of this packet. Adding a test turns CI red until `BASELINE_TESTS`
  is raised in the same commit, and that is the intended direction.

## Rules

**Content is concise and honest, in that order.** The site documents a platform
in early development, so the failure mode to avoid is confident documentation of
something that does not exist yet. Every service page carries a status line that
says what is built and what is not; every command that has not shipped is
marked <span class="badge caution">Coming soon</span>. When you do not know
whether something works, write that you do not know — a gap the reader can see
is worth more than a sentence that reads well and is wrong.

**Re-derive a claim before you keep it; do not inherit it.** A status line, a
test count and a lint result are all true on the day they were written and false
by the next packet, and this repository's drift was entirely that kind. Two
rules that follow:

- **Run the command.** The drift audit is produced by executing
  `caf contract lint` over the workspace, not by remembering what it said last
  time. A table that was copied rather than re-run is a changelog with a table
  in it.
- **A service repository is read-only here.** When its README contradicts its
  own code, the code is right and the contradiction goes in the drift audit as a
  finding. Editing another repository's prose to match this site is out of scope
  even when the edit is obviously right.

**`core` is the source of truth; this site summarizes it.** `contracts.md`
describes `cafaye.yml`, the event envelope, and OpenAPI. Those specs are owned
by
[cafaye/core](https://github.com/cafaye/core/blob/master/docs/manifest-conventions.md)
and are manager-owned. Where this page and `core` disagree, `core` is right.
Never invent a contract detail here — link to the schema instead.

**One service, one page, one file.** `src/content/docs/services/<name>.md`, and
the `language` and role come from PLAN.md §tree and the org README. Add the
service page and the sidebar entry (it is autogenerated from the directory, so
a new file in `services/` appears automatically) in the same commit.

**The sidebar is a claim about the site.** Every entry in `astro.config.mjs`
promises a page exists. A dangling slug fails the build — Starlight resolves
every `slug:` at build time — and `tests/smoke.mjs` checks the same thing
without a full build, naming the broken slug in one line. If you delete or
rename a page, fix the sidebar in the same commit.

**Keep search off.** `pagefind: false`. Starlight's default is to build a
Pagefind index at the end of every build; the packet forbids search indexing,
and a search box over ten pages is noise anyway. Turning it on is a decision to
carry a search index, not a one-line change to make.

**No analytics, no third-party scripts, no blog.** A docs site that phones home
is a privacy surface and a maintenance burden this project has not agreed to
carry. If you need something measured, raise it.

**`site:` in `astro.config.mjs` is the real origin.** It is
`https://docs.cafaye.com` and every canonical URL resolves against it. Change it
in the same commit as a real domain change, never locally.

## Layout

```
astro.config.mjs          site URL, Starlight config, the sidebar (a promise about pages)
src/content.config.ts     Starlight's docs collection + an empty i18n collection
src/content/docs/         every page; index.mdx is the splash home
src/pages/404.astro       /404, owned here rather than injected by Starlight
tests/smoke.mjs           the build-output half: dist/index.html, every sidebar page,
                          every internal link, every icon, both directions
tests/links.mjs           the link half, offline: every #fragment resolves, every internal
                          link resolves, redirects resolve and shadow nothing, every
                          external href is a well-formed https URL
tests/examples.mjs        the examples: every sh fence parses, every json fence is JSON,
                          every yaml fence is a manifest, every caf invocation is a
                          subcommand caf lists
tests/contracts.mjs       the contract tier, run by `bin/prime --contracts`: manifests
                          through the real `caf contract lint`, event types against
                          core's catalog, span names against core's span-naming schema,
                          and observability.md's per-service telemetry table against
                          core's fleet.yml
bin/prime                 the gate: npm ci, build, the offline suite. --contracts adds
                          the contract tier, --fast stops after the install
bin/check-external-links  the network tier: do the external links answer. No retries
.github/workflows/        ci.yml (gate, contracts, pins) and external-links.yml (network)
cafaye.yml                the cafaye manifest, so the org tooling finds this repo
mise.toml                 node 22.19.0 — covers Astro 7's floor and every transitive engine
```

## Style

- `set -euo pipefail` in every shell script; `chmod +x` on every script this
  repository hands out.
- Comments explain **why**, not what. A comment restating the line below it is
  noise; a comment recording a decision that would otherwise be relitigated is
  the point. The headers in `astro.config.mjs`, `cafaye.yml`, and `bin/prime`
  are the model.
- One sentence per line in Markdown body text, which keeps diffs readable.
- Wrap Markdown at a readable width; do not reflow a file you did not otherwise
  change.

## Before you commit

- [ ] `bin/prime` is green, and you have pasted the output
- [ ] `bin/prime --contracts` is green too, if you touched a page with an
      example, an event type or a span name in it
- [ ] No new page is missing from the sidebar, and no sidebar entry lacks a page
- [ ] Every code fence you touched parses, and every `#fragment` you wrote points
      at a heading that exists
- [ ] Every command, count and table on the changed pages was **run**, not copied
      from the previous version of the page
- [ ] Status lines still match what the service repositories actually claim —
      and any repository whose README contradicts its own code is in the drift
      audit rather than edited
- [ ] `README.md` still matches the tree (run commands, deploy steps)
- [ ] `CHANGELOG.md` has an entry
- [ ] You did not weaken the gate, loosen an assertion, add a skip, or add a
      dependency to get to green

## Repo hygiene

- **No dependencies without approval.** Astro and Starlight are the only two,
  and they are the site. Adding a plugin is a decision about what this project
  carries, not a convenience.
- **Do not touch anything outside this worktree.**
- **Bound long or networked commands with `timeout N`** — `npm install` and
  `npm run build` especially.