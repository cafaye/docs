# REPORT — docs-06-gate

**Worktree:** `/Users/kaka/Code/any/moon/cafaye/docs-worker-docs-06-gate`
**Branch:** `worker/docs-06-gate` · **Remote:** `git@github.com:cafaye/docs.git` (SSH)
**Not pushed.** The manager pushes after the gate is green.

## What this packet was for

`core` publishes a gate format (`schemas/gate.schema.json`), a checker
(`harness/gate_check.py`) and the reasoning (`docs/gate.md`). Six of thirteen
services declared a `gate.yml`. This repository was one of the seven that did
not, so `bin/prime` existed here and nothing said what it was worth.

`gate.yml` is written. It declares **eight proofs, five with a floor**, and every
number in it came out of a real run of the declared command on this tree.

## The measurement first: three commands, not one

The packet asks for the developer-facing command and the CI command, and for the
difference between them to be recorded. All three spellings were run here:

| | command | what actually ran |
|---|---|---|
| developer default | `mise run prime` → `./bin/prime` | **16 tests**, contract tier **not run** |
| CI `gate` job | `bin/prime` | 16 tests, **plus 3 assertions `bin/prime` does not make** |
| CI `contracts` job | `bin/prime --contracts` | **22 tests** (16 offline + 6 contract) |

**The difference worth catching is real and it is two differences.**

**1. `bin/prime` alone is a strict subset.** It prints `skipping the contract
tier (--contracts); it did NOT run` and exits 0 — honestly, which is why
`gate.yml` declares the flag. Those six tests are the only ones that can catch a
documented example contradicting a shipped contract.

**2. `./bin/prime --contracts` is green on a tree that CI is red on.** This one
is not visible to the checker at all, because `ci.invokes` is read textually and
these are assertions made *around* the gate. The `gate` job adds:

- **suite size by equality** (`BASELINE_TESTS: '16'`, `==`, not a floor),
- **`# skipped` must be zero**,
- **the tree is byte-identical afterwards** (`git diff --exit-code` plus
  `git status --porcelain`).

And CI runs two things this gate does not run at all: the whole `pins` job, and
`external-links.yml`. So a developer who deletes a test gets a quiet local green
and a red build. Recorded in `gate.yml` under `ci:`, not closed — closing it
means moving CI's assertions into `bin/prime`, which changes the gate's
behaviour and is not this packet's to do.

## The declared gate

```
command:  [bin/prime, --contracts]
miseTask: prime          # which runs bin/prime WITHOUT --contracts — recorded, not reconciled
entrypoint: bin/prime
timeoutSeconds: 1200     # CI's own budget; measured warm run is ~75s
```

### Measured counts (from a real `bin/prime --contracts`)

| proof | reads | floor | what it catches |
|---|---|---|---|
| `offline-suite` | 16 | 16 | the offline tier ran at its measured size |
| `offline-no-skip` | — | — | nothing skipped in the offline tier |
| `contract-tier-ran` | 6 | 6 | **the contract tier is not optional to anybody** |
| `contract-no-skip` | — | — | nothing skipped in the contract tier |
| `manifests-validated-by-caf` | 2 | 2 | the docs' manifests reached the real validator |
| `caf-lint-output` | — | — | **`caf` itself produced output** |
| `event-claims-checked` | 8 | 8 | the prose vs core's catalog of 30 |
| `span-names-checked` | 6 | 6 | the prose vs core's span-naming pattern |

All eight verified against the checker's own captured log using its own
`strip_ansi` + `re.MULTILINE` code path, not by eye.

### Pass count and skip count, reported separately

- **Offline tier: 16 tests, 16 pass, 0 fail, 0 skipped.**
- **Contract tier: 6 tests, 6 pass, 0 fail, 0 skipped.**
- **Whole gate: 22 tests, 22 pass, 0 skipped.**
- **Environment-gated: nothing.** No tier skips by construction, and the two
  tiers that need the environment (`CORE_PATH` for `core`, `CAF` for the binary)
  **fail with a named message** rather than skipping — measured, red proof 2 below.
- The environment variables this gate honours are `CORE_PATH` and `CAF`, both
  paths. **There is no credential requirement and no secret anywhere in the
  gate**; `ci.yml` takes `permissions: contents: read` and no `secrets:`.

## Two things I had to get right that were not obvious

**The floor could read the wrong number.** `--contracts` makes `node --test` run
**twice**, and both summary blocks are the same shape. The checker reads the
**last** match. So a bare `^# pass ([0-9]+)$` on this gate reads **6**, not 16 —
a floor of 16 would be `gate.floor` on a fully green run, and a floor of 6 would
be satisfied by the offline tier on a run where the contract tier never
executed. Four proofs are therefore anchored to the `== …` banner `bin/prime`
prints before each tier, with a **non-greedy** `(?s)` prefix so the match is the
tier's *first* summary. Verified by reading the captured log: `offline-suite`
reads 16 and `contract-tier-ran` reads 6, in the same run.

**The fleet's zsh false green reproduces on this machine.** Measured while
writing the file: under zsh `${PIPESTATUS[0]}` after `bin/prime | tee log`
expands to the **empty string**; under bash to the gate's real status. So the
`shell: bash` + `${PIPESTATUS[0]}` spelling already in `ci.yml` is not defensive
style — under zsh it reads no status at all.

## The red proofs — a gate that has never been red is not a gate

Three, each a different class. All run against this `gate.yml`, on this tree.

### 1. The offline tier loses its two load-bearing files

`tests/links.mjs` and `tests/examples.mjs` removed from the `test` script — the
two files `AGENTS.md` calls "the whole deliverable".

> `bin/prime` **exited 0.** `# tests 7 / # pass 7 / # fail 0 / # skipped 0`.
> `FAIL gate.floor: proof 'offline-suite' reported 7 and the declaration's floor is 16`

That is the packet's premise, run rather than argued: a developer deletes the
link and example checks to reach green, `bin/prime` stays green, and the
declaration is the only thing that notices. Note the checker reported **exactly
one** finding — the absence of `gate.nonzero` is the record that the gate itself
was green.

### 2. `core` is not on disk

`CORE_PATH` pointed at an empty directory:

> `FAIL gate.nonzero: the gate exited 1`
> `FAIL gate.floor: proof 'contract-tier-ran' reported 3 and the floor is 6`
> `FAIL gate.proof-missing: proof 'event-claims-checked' never appeared`
> `FAIL gate.proof-missing: proof 'span-names-checked' never appeared`

Three of the six contract tests still passed, because three of them do not read
`core`. **Nothing skipped** — which is the property `tests/contracts.mjs` was
written to have, and the reason an unreadable contract is a named failure rather
than a green badge over a check that ran nothing.

### 3. `CAF=/usr/bin/true` — the packet's premise, verbatim

> "A checker replaced by a function that unconditionally exits 0 would leave this
> repository green."

**It nearly did.** All 22 tests passed — 16 offline, 6 contract, 0 fail, 0
skipped, exit 0 — including:

```
ok 3 - every cafaye.yml example in the docs passes the real caf validator
#     \# manifests validated by caf contract lint: 2
```

The count-based proof `manifests-validated-by-caf` was **satisfied by the stub**,
because that `console.log` lives in the test and not in `caf`. The single thing
that changed in the entire log is that `caf contract lint`'s own stdout line
stopped appearing, so:

> `FAIL gate.proof-missing: proof 'caf-lint-output' never appeared`

That is why `caf-lint-output` exists with **no floor and no count in it**: it is
the only proof in the file that a program actually ran. A proof that only counted
things would have been green.

Its cost, stated: the phrase `OK <path>` belongs to `caf`, not to this
repository. If `caf` rewords it, the proof goes red and names itself.

## Findings — two stale claims about this repository's own gate

Both were found by measuring, and both are the kind of drift this repository's
own `AGENTS.md` says to look for. Neither is a code defect; both are the
repository asserting something false about itself.

1. **`running-the-gates.md` said this repository has no CI.** It listed `docs`
   in a "does not have a CI workflow" column and told the reader to *"treat a
   badge on `docs` as an absence of evidence rather than evidence of absence."*
   Both were true until docs-05 and neither was true after it — `ci.yml` and
   `external-links.yml` have been on `master` since. On the fleet runbook, in
   this repository's own prose, a reader was being told not to trust this
   repository. Its `docs` row also named only `bin/prime`, omitting the contract
   tier and both prerequisites that tier needs.
2. **`AGENTS.md` claimed "26 external links"** where the suite measures **50**.
   The other five counts on that line were re-measured and are correct.

**Scope note, because it would have been easy to overreach:** the rest of the
`running-the-gates.md` table describes twelve *other* repositories. I did not
re-measure those from inside this worktree and did not touch them. `cafaye-py` is
on neither side of that table, and the page now says so explicitly rather than
being silently wrong about it — a row there is only correct if it was read out
of the repository it names, and this repository's suite cannot reach
`cafaye-py`.

## Judgement calls, and the reasoning

- **Declared `[bin/prime, --contracts]`, not `[bin/prime]`.** Declaring the
  default would be true and useless: the declaration would be satisfied by a run
  that checked sixteen properties of the text and validated **zero** manifests
  against core's schema. `muse` argues the same for its three skipped tests and
  `darkroom` for its `--db`. Declaring the subset is declaring the badge.
  Cost: this is not what a contributor with one checkout can run, which is why
  `external.selfContained` is `false` with four demonstrated requirements and
  why the `miseTask`/`command` difference is written out rather than papered
  over. (`miseTask` *cannot* be `prime:contracts` — the schema constrains it to
  `^[a-z][a-z0-9-]*$`.)
- **Floors at the measured value, with no margin.** `muse` and `cafaye-rb` sit
  below today's number so adding a test does not require an edit. I did not,
  because this repository already holds 16 by **equality** in CI and
  `AGENTS.md` says that is the intended direction. A floor is also all this
  format can express; the equality that forces a human to look at the number
  before raising it lives in the workflow, and `gate.yml` says so.
- **Did not reconcile the local/CI gap.** Adding CI's three assertions to
  `bin/prime` would make the difference disappear, but it changes what the gate
  does. The packet asks for the difference to be *caught and recorded*; it is.
- **`external.selfContained: false` with npm on *every* run**, not "once on a
  cold checkout" as the other repositories spell it. `npm ci` deletes
  `node_modules` and reinstalls the lockfile every time — measured, in a copy of
  the manifest so the worktree was untouched.

## Constraints held

- **No assertion was weakened.** The three red proofs were produced by breaking
  things, not by loosening anything; `package.json` was restored and verified
  clean (`git status --porcelain -- package.json` → 0 lines) after red 1.
- **No sleeps. No raised retry counts. No new skips.** `timeoutSeconds` is a
  budget, not a retry, and it is CI's own.
- **No secret is at rest, logged or in configuration.** Nothing in the gate
  prints a credential; the two env seams are `CORE_PATH` and `CAF`, both paths.
- **`core` was not edited.** `harness/gate_check.py`, `schemas/gate.schema.json`
  and `docs/gate.md` were read only.
- **One suite at a time.** Every heavy run here was serial — 1 green, 1 static,
  3 red, 1 final — on a machine reporting load average 138.
- **Not pushed.**

## What the next reader should check

1. **Adding a test turns this declaration red** until the two floors (16 and 6)
   and `BASELINE_TESTS` are raised in the same commit. That is the intended
   direction.
2. **If `caf` changes its lint wording**, `caf-lint-output` goes red. Fix it
   here, in the same commit.
3. **`node --test`'s summary shape is load-bearing for four proofs.** If a Node
   upgrade reorders or renames those lines, four proofs go red at once. That is
   loud, which is the intent — but it is the first thing that will break.
4. **`mise run prime` is still the 16-test subset.** If a contributor's change
   touches a page with an example, an event type or a span name, the gate is
   `./bin/prime --contracts`, and `gate-check --prove` is the machine-checked
   statement of that.