# MEASUREMENTS — the contract tier's cost, before and after

Every number here was **run on this branch**, with the command printed above it.
Nothing is quoted from `moon/RESEARCH-fleet-velocity.md`; where that document's
figure is mentioned below, it is to say it did **not** reproduce here.

Machine: darwin, node 22.19.0 (the `mise.toml` pin), caf built from
`cafaye/caf` `master` with `go build -o caf ./cmd/caf` — the same binary CI's
`contracts` job builds, which is the only binary this measurement is honest
about. See "The binary is part of the measurement" for why.

## BEFORE — one `caf` process per manifest

    cd docs && CAF=/tmp/caf node --test tests/contracts.mjs

Five consecutive runs, wall clock:

| run | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| seconds | 0.18 | 0.19 | 0.18 | 0.18 | 0.18 |

**3 `caf` invocations** (`tests/contracts.mjs:89`, once per manifest: two
````yaml` fences plus this repository's own `cafaye.yml`).

The cost is the spawn, and the spawn is nearly all of it. Measured directly:

    # 100 invocations, one manifest each — the shape the tier uses today
    for i in $(seq 100); do /tmp/caf contract lint <one file> >/dev/null; done
    #   → 1.29 s, i.e. ~12.9 ms per spawn

    # one invocation over a tree holding those same three manifests
    /tmp/caf contract lint <tree>
    #   → 0.01 s

So the tier paid roughly **39 ms of process startup** to validate three
manifests, out of a 180 ms run. The linting itself is ~1 ms per manifest.

### The research's 133–223 s did not reproduce here, and here is why

`moon/RESEARCH-fleet-velocity.md` P0-2 attributes this tier's cost to process
spawn and measures it at 133–223 s. That is **not** this repository's number.
This branch has **two** ````yaml` fences in the whole site, so the tier spawns
three processes and finishes in 0.18 s. A tree with ~10 000 manifests would
land in the research's range at ~13 ms each; this site is three orders of
magnitude smaller than that. The finding is right about the *cause* — spawn, not
linting — and the number belongs to a larger tier. It is recorded here so the
next reader does not go looking for 133 s on this repository.

## AFTER — one `caf` invocation for the whole tree

    cd docs && CORE_PATH=../core CAF=/tmp/caf node --test tests/contracts.mjs

Seven consecutive runs, wall clock:

| run | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| seconds | 0.15 | 0.14 | 0.18 | 0.14 | 0.15 | 0.15 | 0.15 |

**1 `caf` invocation** (`tests/contracts.mjs:217`, `execFileSync(caf, ['contract',
'lint', dir])`) for all three manifests.

| | BEFORE | AFTER |
| --- | --- | --- |
| `caf` processes | 3 | 1 |
| tier wall clock (median of 5 / 7 runs) | 0.18 s | 0.15 s |
| `bin/prime --contracts` | green | green |
| offline tier | 16 tests, 0 skipped | 16 tests, 0 skipped |
| contract tier | 7 tests, 0 skipped | 7 tests, 0 skipped |
| all 8 `gate.yml` proofs | satisfied | satisfied |

The 30 ms is real but small, and it should be: this site has two fences. The
number worth having is the **marginal** cost, because it is what made the
research's figure large and what this change removes.

### The marginal cost, measured rather than extrapolated

Forty copies of a documented example, plus this repository's own manifest —
41 files, the shape a site with forty manifests would produce:

    # OLD shape: one process per manifest
    for f in <tree>/*/cafaye.yml; do /tmp/caf contract lint "$f"; done
    #   → 0.41 s

    # NEW shape: one process for the whole tree
    /tmp/caf contract lint <tree>
    #   → 0.01 s

**41×, at 41 files.** The old shape's cost is linear in the number of manifests
and the new shape's is flat, so the ratio grows with the tree: the two numbers
above are the same measurement the research's 133–223 s was, taken at a size
this repository can actually hold. At the measured ~12.9 ms per spawn, 133 s is
about **10 300 manifests** and 223 s about **17 200**. Neither is reachable
from this site, which has two.

## The binary is part of the measurement

The first BEFORE run on this branch used whatever `caf` was on `PATH`, which is
a **stale mise install from 2025-09-30**. It reported

    OK …/example-0.yml

for a manifest that the `caf` built from `master` today rejects. The tier is
therefore **green against the stale binary and red against the one CI builds**,
and the difference is not a flake: it is the whole reason the numbers above are
taken against a freshly built `caf`. `CAF` is the seam, `bin/prime --contracts`
and CI both set it, and a measurement taken against an arbitrary `caf` on
`PATH` measures the wrong tool.

This mattered to the packet, not just to the measurement: that staleness is why
the tier was **red on master in CI** before the call shape changed, and the fix
is described in the commit that changed it, under "ONE PROCESS, ONE PARSE" in
`tests/contracts.mjs`.
