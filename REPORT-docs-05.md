# REPORT — docs-05-links

**Worktree:** `/Users/kaka/Code/any/moon/cafaye/docs-worker-docs-05`
**Branch:** `worker/docs-05` · **Remote:** `git@github.com:cafaye/docs.git` (SSH)

## The gap, measured

`docs` had no `.github/` directory at all. It had a gate (`bin/prime`) and a
`test` script; nothing was calling either. A gate nobody runs is a comment about
a gate.

Baseline on arrival: **7 tests, 7 pass, 0 skipped**. On departure: **22 tests,
22 pass, 0 skipped** (16 offline + 6 contract).

## What I built

### 1. CI

`.github/workflows/ci.yml` — `gate`, `contracts`, `pins`. Plus
`.github/workflows/external-links.yml` for the network tier, deliberately a
separate file on separate triggers.

**This repository does not call kit's reusable workflow.** The packet asks me to
say so with the specific missing piece if kit cannot express what a docs site
needs, and to state the trade-off. Three measured reasons:

| # | The gap | Measured how |
| - | ------- | ------------ |
| 1 | kit's `node` job has **no build step**, and this repository's suite asserts against `dist/` | On a fresh clone of this branch, `npm ci && npm test` with no build: **3 pass / 4 fail**. The four are exactly the assertions that read `dist/index.html`. A reusable workflow cannot be handed an extra step, and `build` is not a kit input. |
| 2 | kit's `node` job runs `npm run lint` **unconditionally** (its coverage step has `--if-present`; its lint step does not), and this repository has no linter | `npm run lint` → exit 1, `Missing script: "lint"` |
| 3 | kit's `none` job would run the gate on **the runner's node**, not the pinned one | `mise.toml` pins `node = "22.19.0"`, `package.json` declares `engines.node: ">=22.19.0"`, and `astro@7` needs `>=22.12.0` |

**The trade-off, stated because it is a real cost: `docs` now receives none of
kit's fixes.** When kit's shared workflow gains a Node fix, a runner upgrade or
a caching improvement, this repository does not get it and will not until someone
ports it. What the departure buys is a gate that runs on the pinned interpreter
*and asserts it*, holds the suite size by equality, and refuses to skip the
contract tier.

The `pins` job makes the departure a decision rather than an accident: it fails
if a `uses:` line ever appears at the stale `workflows/ci.reusable.yml` path
(which resolves to nothing), and it fails if the header stops explaining why kit
is not called.

**Yes, `docs` needed the `pins` assertion, and it needed it more than billing
does** — billing asserts the path it uses; `docs` has to assert both the path it
deliberately does not use and that the reason stays written down.

### 2. The gate

| file | asserts | red-proved by |
| --- | --- | --- |
| `tests/links.mjs` | every `#fragment` names a heading that exists; every internal link names a built page; every redirect resolves and shadows no live page; every external href is well-formed `https:` with a real host and no placeholder | a deep link to a heading that does not exist; a redirect to a page that does not exist; an `http://` link |
| `tests/examples.mjs` | every ` ```sh ` fence parses under `bash -n`; every ` ```json ` fence is valid JSON; every ` ```yaml ` fence is a manifest; every `caf` invocation names a subcommand the quoted `caf help` lists | a dangling line continuation; a trailing comma; an invented `caf` subcommand; an undeclared placeholder |
| `tests/contracts.mjs` | documented `cafaye.yml` examples and this repository's own through the **real `caf contract lint`**; event-type claims against core's catalog; span names against core's `span-naming.schema.json` | a schema-invalid key; a claim about a type core does not publish; a span name core's pattern rejects; **`core` absent** and **`caf` absent**, both of which must be red and never a skip |

Counts, printed so a check that finds nothing does not look like a check that
passed: **103** shell fences, **11** JSON fences, **2** manifests, **6** `caf`
subcommands (vocabulary of 12 read from the quoted help), **50** external links,
**0** redirects, **8** event-type claims against core's **30** published types,
**6 good / 4 rejected** span names.

### 3. Documentation

`AGENTS.md` gains a gate section that says what each file asserts, a **"what a
red here means"** table, an explicit "things not to do to get to green", and a CI
section naming the three measured reasons kit is not called. `README.md` and
`CHANGELOG.md` follow.

## Documentation bugs the gate found, and what the real answer was

Four, all fixed in the documentation. **No example was changed to make a test
pass; in every case the example was the thing that was wrong.**

1. **A deep link that resolved to nothing.** `troubleshooting.md:156` pointed at
   `/runbooks/service-down/#darkroom--object-storage-is-a-separate-failure-from-its-database`.
   The text it names (`runbooks/service-down.md:241`) is a **bolded paragraph,
   not a heading**, so no such id was ever emitted. The *claim* is correct and
   still on that page; the fragment was wrong. Now points at
   `#step-4--both-probes-are-200-and-the-application-is-broken`, the section that
   actually contains it. This is the exact class the packet names — a link to a
   page that exists is not a working link — and it passed the whole pre-existing
   suite.

2. **`upgrading.md` — a ```json fence that is not JSON.** It showed the two
   `billing.payment.succeeded` shapes in one fence with `//` comments. JSON has
   no comment syntax and a fence with two top-level values is not a document.
   Now one branch per fence, with the labels in the prose above. The schema
   claim is untouched: core D11 really does declare this a `oneOf`.

3. **`secret-rotation.md` — a ```json fence with two documents.** Two
   consecutive `curl` outputs in one fence. Split into two, labelled "Liveness,
   which says nothing about the database" and "Readiness, which is the one that
   has to name it" — which is what the prose immediately below already argued.

4. **`tests/examples.mjs` found a `caf` vocabulary, and I nearly shipped it
   wrong.** The first version read the *second* word after `caf` as part of the
   subcommand name, so `caf deploy identity` and `caf help init` both failed
   against correct examples. `contract` is the only `caf` command that owns
   subcommands. The check now takes the second word only under `contract`, and
   the vocabulary is read from the `caf help` output **quoted in
   `getting-started.md`** rather than from a list written beside it — so there is
   one place in this repository that says what `caf` can do.

## Two bugs the red proofs found in my own CI

Both would have shipped, and both are recorded in the files.

- **The suite-size guard read `node --test`'s summary by field position.** The
  line begins with `#`, so every offset shifted and `skipped` received the
  literal string `fail 0 # skipped 0`. The guard then reported "0 test(s)
  skipped" on a **fully green run** and failed every build. It is now four greps
  that each name the metric they want — not a bet on the reporter's field order.
  Red-proved five ways: green as shipped; red on a shrunken suite, on a skip, on
  a failure, and on a missing summary line.
- **Three of my own `pins` greps matched their own text.** The unanchored
  `uses: cafaye/kit/` matched this file's migration instructions and the `echo`
  that quotes the path; the "is the reason still written down" check matched its
  own `for phrase in …` list, so it would have passed on a file whose entire
  explanation had been deleted. Fixed by anchoring to the start of a line, by
  reading only the top-level comment header, and by writing each phrase as two
  adjacent quoted fragments. This is the "a grep that finds its own pattern gets
  deleted" failure in its purest form, and it is why this file says so.

## Deliberate decisions a reviewer should argue with

- **External links: a slow link FAILS.** It is not retried and not skipped. A
  link a reader cannot reach is a broken link from the reader's side, and a
  checker that retries until the network obliges reports "fine" during the outage
  it exists to catch. The cost is real: a genuinely slow third party turns the
  job red with no defect here. That is why it is a separate file on separate
  triggers and **never on a pull request** — a contributor's PR must not go red
  because GitHub was slow. The job prints every unreachable URL by name so a red
  is triageable in one read. **No retry, no sleep.**
- **A redirect is reported, not passed.** A 3xx is its own bucket, not "fine" —
  a redirect to a page that then 404s is a broken link wearing a hat.
- **The placeholder substitution list is closed.** `tests/examples.mjs`
  substitutes four documented placeholders (`<name>`, `<command>`,
  `<pg-container>`, `<superuser>`) before `bash -n`, and a *separate test* fails
  on any angle-bracket placeholder it does not declare. So the convention cannot
  quietly grow to swallow whatever breaks next.
- **No YAML parser in the offline tier.** `js-yaml` is in the tree but only as
  a **transitive** dependency of Astro and Starlight, and AGENTS.md's rule is
  that those two are the only dependencies. A gate reaching into somebody else's
  dependency tree breaks on an unrelated upgrade — and it would be the *weaker*
  check anyway, since `caf contract lint` against core's real schema is the
  better answer to "is this manifest correct".

## Red proofs

Every check was shown failing on a deliberately broken input before being shown
passing. **15 red proofs, all RED**, plus 4 more for the suite-size guard
(green-as-shipped plus four reds) and 2 for the kit-path guard (which correctly
fires on the stale path and does **not** fire on the documented one).

Measured on real content, before any fix, the first run of `tests/links.mjs` was
red on the broken anchor above and on nothing else; the first run of
`tests/examples.mjs` was red on both JSON fences and on nothing else.

## Findings for other repositories — not actioned here

1. **`identity`'s `openapi/v1.yaml` does not declare ten routes its router
   serves, and this site documents all of them.** Measured on `identity@e500262`
   ("Merge worker/identity-09: hold openapi/v1.yaml to the router, by method and
   path"). The router registers them at `internal/httpapi/accounts.go:548-559`
   and `internal/httpapi/oidc.go:872-876`; the document declares 15 paths and
   none of these:

   ```
   POST   /v1/accounts                                        accounts.go:548
   GET    /v1/accounts                                        accounts.go:549
   GET    /v1/accounts/{accountID}                           accounts.go:552
   PATCH  /v1/accounts/{accountID}                           accounts.go:553
   DELETE /v1/accounts/{accountID}                           accounts.go:554
   GET    /v1/accounts/{accountID}/members                   accounts.go:556
   POST   /v1/accounts/{accountID}/invitations               accounts.go:557
   PATCH  /v1/accounts/{accountID}/members/{userID}          accounts.go:558
   DELETE /v1/accounts/{accountID}/members/{userID}          accounts.go:559
   POST   /v1/invitations/accept                             accounts.go:550
   ```

   **This site's topology table is correct and `identity`'s document is
   incomplete.** That is a finding for `identity`, not a docs bug, and per the
   packet's constraint I did not edit a sibling repository. It is also why I did
   **not** add a "every documented path is in the OpenAPI document" gate: it
   would be red for a reason that is not a defect in this repository, and a gate
   that is red for someone else's reason is a gate that gets disabled.

2. **`cafaye-ts`'s vendored `specs/identity.yaml` is behind `identity`'s
   document.** It carries 12 paths and 16 operations at commit `35c2576`; the
   live document has 15 paths and adds `/v1/accounts/{account_id}/api-keys*` and
   `/v1/introspections`. `cafaye-ts`'s own `AGENTS.md` and `specs/index.json`
   both say this is deliberate and pinned, so it is recorded rather than acted
   on.

## What I could not verify

1. **The workflow has never run on GitHub.** Both files parse as YAML and every
   step's shell was executed locally against real inputs, but Actions semantics
   are not things I can execute: expression contexts, `runner.temp` availability
   at step scope, and the reusable-workflow resolution rules were read from the
   documentation and from the fleet's working files, not observed. The first push
   to `worker/docs-05` is the first real run, and the manager should read that
   run's log rather than trust this sentence.
2. **The `contracts` job's `caf` build was not exercised on a runner.** I built
   `caf` from a sibling checkout on this machine and ran the tier against it;
   the job clones `cafaye/caf` and builds it the way `cafaye-ts`'s CI already
   does, but that exact clone-and-build inside Actions is unrun.
3. **I could not measure the runner's default node**, which is reason 3 for not
   adopting kit's `none` job. The claim is that a gate on "whatever the image
   ships" is weaker than one on the pinned 22.19.0; whether that would have
   *failed* in practice on `ubuntu-latest` is a measurement I could not take.
4. **The external-link tier has run exactly once**, on this machine, at
   `--timeout 8000`: 26 ok, 0 redirect, 0 broken, 0 unreachable. It has never
   been observed rejecting anything, because no link is currently broken. Its
   verdict vocabulary is red-proved by construction (three outcome classes, each
   from a distinct branch) but not by a real dead link.
5. **`tests/contracts.mjs`'s event-type filter is narrower than "every event
   type in the prose", deliberately.** It excludes sections whose heading is
   about drift, and it requires a claim-verb on the line. That is 8 claims out
   of 57 three-segment tokens in the prose. The 49 excluded tokens are span
   names, filenames, hostnames and the types `topology.md`'s drift table exists
   to record as *not* published. A reviewer should check that filter and decide
   whether it is the right one; I found the lexical alternative unsound, because
   one drift row says "It declares **five** types" and lists the three that are
   not among them in the same sentence.
6. **Nothing was run against `postgres`, a Docker daemon, or any cafaye
   service.** No example that needs one is executed. The `sh` fences are parsed,
   not run — which catches the rot that is nearly always a broken continuation
   or an unterminated quote, and does not catch an example whose *arguments* went
   stale. The `caf` subcommand check is the only one that looks at meaning, and
   it covers the command name only, not its flags.
7. **I did not verify the 26 external links resolve from a GitHub runner**, only
   from this machine. GitHub's runner IPs are rate-limited differently, and a
   429 from the job is a red I have designed for but never seen.
8. **`dist/` was built with a pre-existing Vite warning** about
   `use astro:head-inject` in `index.mdx`. Pre-existing, not introduced here,
   and not something this gate asserts about.
