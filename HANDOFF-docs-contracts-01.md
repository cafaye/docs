# HANDOFF — docs-contracts-01

Worktree: `wt-m39-docs-contracts-01` · branch `worker/docs-contracts-01` ·
base `d0197b5`. Report: `moon/logs/REPORT-docs-contracts-01.md`.
**Push is not mine. Nothing was pushed or merged.**

## Done and verified

| | |
| --- | --- |
| BEFORE | 3 `caf` processes, tier median **0.18 s** |
| AFTER | 1 `caf` process, tier median **0.15 s** |
| Marginal, at 41 manifests | **0.41 s → 0.01 s**, measured |
| `bin/prime --contracts` | exit 0 — 16 offline, 7 contract, 0 failed, 0 skipped |
| `gate.yml` proofs | 8 / 8 matched by hand against a real run's log |
| Honest negatives | 4, all red, all quoted in the report |
| caf / core / other repos | **untouched** |

Commits: `6ef4dac` measure · `008602d` the change · `123c46f` changelog +
gate timing · one tidy-up commit after this file was written.

The headline finding is not the 30 ms. **The contract tier was red in CI**:
`contracts.md`'s ````yaml` example names `exposes.api` and ships no OpenAPI
document, and `caf` master rejects that. The old call shape handed every fence to
`caf` as if it were a repository root. Linting the fences as manifests in one
tree uses `caf`'s own distinction (a nested manifest is a copy, not a
repository's own) and is green. See the report's section on it before merging —
it is the one thing a reviewer should form their own view on.

## Half-done, and why

Nothing in the packet is half-done. Three things were deliberately left, listed
so nobody rediscovers them:

1. **`gate.yml`'s test counts are stale and I did not fix them.** Its header says
   "16 offline + 6 contract = 22" and "Six tests, measured"; the contract tier
   has run **7** tests since before this packet. The proof floor is
   `minimum: 6`, so nothing is red — but the prose is wrong, and AGENTS.md says
   a count must be re-derived rather than inherited. I only touched the one line
   that times the tier, because that is the gate doc the packet lets me touch.
   The successor's first move is the three numbers.
2. **The `caf` on `PATH` on this machine is stale** (mise install, 2025-09-30).
   It accepts manifests `caf` master rejects, which is how this tier looked
   green for months. Not a repository problem and not mine to fix, but it is
   why every measurement and every local run in this packet used
   `CAF=/path/to/freshly/built/caf`. Anyone re-measuring without `CAF=` will get
   a different, wrong answer.
3. **No `gate-check --prove` was run** — no `gate` checkout and no `gate-check`
   on this machine. The eight proofs were matched by a python script applying
   each proof's regex and floor to the log of a real `bin/prime --contracts`
   run. That is close but is not the real checker.

## Currently-failing command

None. `bin/prime --contracts` exits 0 on this branch with a freshly built `caf`
and `CORE_PATH` pointing at `../core`.

For reference, the one that *was* red before this change, now fixed:

    CORE_PATH=/Users/kaka/Code/any/moon/cafaye/core \
      CAF=/tmp/caf-built-from-master \
      node --test tests/contracts.mjs
    # was: not ok 3 — src/content/docs/contracts.md:22: exposes/api:
    #      openapi/openapi.yaml is not a readable OpenAPI document

## The successor's first move

Read the report's "The finding that matters more than the 30 ms" section and
decide whether you agree that a ````yaml` fence is a copy of a manifest rather
than a repository. If you do not, the alternative is not "revert" — it is one
invocation for the fences plus one per fence that names an `exposes/api`
document, which keeps the adjacency rule at the cost of a process per such
fence, and that is worth arguing about explicitly rather than choosing quietly.

Then fix the three stale counts in `gate.yml`'s header comment.
