// tests/contracts.mjs — the examples checked against the real contracts.
//
// WHAT MAKES THIS TIER DIFFERENT FROM tests/examples.mjs
//   Everything in examples.mjs is a property of the text: does this parse, does
//   this name a command. This file checks the text against **something outside
//   this repository** — the `cafaye.yml` examples against core's real manifest
//   schema, through the real `caf` binary. That is the check the packet calls
//   the strongest argument for the packet, because it is the only one that
//   catches the failure a self-hoster actually hits: an example that is
//   perfectly valid YAML and perfectly wrong, because the platform moved.
//
// WHY IT IS A SEPARATE FILE AND A SEPARATE TIER
//   It needs two things the unit tier must not have:
//
//     1. **A checkout of `cafaye/core`.** The schema is core's; this repository
//        does not vendor it and must not — a vendored copy is a fourth
//        description of the manifest format that nobody updates.
//     2. **A built `caf` binary.** `caf contract lint` is the house validator.
//        Re-implementing manifest validation here would be a second, weaker
//        answer to a question core already answers, and a weaker one that
//        reports "no problem" for a document it misread.
//
//   So this is a **tier**, not a test that quietly skips. `bin/prime` runs the
//   unit tier; `bin/prime --contracts` adds this one, and the CI `contracts`
//   job checks out core, builds `caf`, and runs it. When core is not on disk
//   this file **fails**, it does not skip — the rule every repository in this
//   fleet writes down and billing's AGENTS.md explains at length: a skipped
//   contract test proves nothing, and a green badge over a tier that ran
//   nothing is the false green this tier exists to prevent.
//
//   A local developer with no sibling checkout still gets a clear message
//   rather than a mystery, so `skip`-shaped behaviour is not possible here by
//   construction: the file exits nonzero and says what to do.
//
//   Run it with:  bin/prime --contracts        (needs ../core and a `caf` binary)
//
// ONE PROCESS, ONE PARSE
//   This file used to run `caf contract lint <file>` once per manifest, which
//   means the cost of this tier was the cost of starting a process per fence.
//   Measured on this branch: ~12.9 ms per spawn against ~1 ms of linting, so
//   the startup was most of what the tier did (MEASUREMENTS-contracts-tier.md,
//   with the before and after and the exact commands).
//
//   `caf contract lint <path>` already takes a **directory** and walks it in one
//   process — `contract.Lint` in caf's `internal/contract/lint.go` is one
//   function over a whole tree, the same "one parse, every rule" shape buf's
//   lint is built on. So the fix was caller-side and needed no change to caf:
//   every manifest this tier validates is written into one scratch tree and the
//   whole tree is validated by **one** invocation.
//
//   **The verdicts are per-manifest and are read out of caf's own output**, so
//   nothing about the assertions was given up. caf prints one line per document
//   it checked, which is why it can answer for a tree without going quiet about
//   any one file:
//
//       OK <path>
//       INVALID <path>: <the first error>
//
//   Two consequences a reader should know rather than rediscover:
//
//     1. **A reported-verdict count is asserted against the manifests written.**
//        Parsing output is how a check goes green over nothing, so the parse is
//        held to "one verdict per manifest, no more and no fewer" — a `caf` that
//        rewords its lines fails here with the raw output in the message rather
//        than passing a tier that checked nothing.
//
//     2. **A fence is linted as a manifest inside a tree, not as a repository
//        root.** caf's walk treats the manifest at the tree's root as "this
//        repository's own" and applies one extra rule to it: a manifest that
//        names `exposes/api` must have that OpenAPI document beside it. That
//        rule exists for real repositories — see the pantry registry note in
//        `lint.go` — and a ```yaml fence is not a repository, it is a copy of a
//        manifest printed in a page. `contracts.md`'s example legitimately names
//        `exposes.api` and ships no document, because it is showing the format
//        rather than being one. Under the old shape (each fence handed to `caf`
//        as if it were a repository) that example was reported INVALID by `caf`
//        master, and this tier was **red on master in CI**. It is red, not
//        flaky: `contracts.md:22`, `exposes/api: openapi/openapi.yaml is not a
//        readable OpenAPI document`. The manifest itself is valid; what it does
//        not have is a sibling file, and adjacency is a property of a
//        repository. Stated here because it is the one thing this change does
//        that could look like a loosened assertion, and it is a corrected call
//        convention rather than a suppressed finding.
//
//   This repository's own `cafaye.yml` is copied to the root of that same
//   scratch tree, byte for byte (asserted), so it keeps being linted as a
//   repository's own manifest and one invocation still answers for it.
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const docs = join(root, 'src', 'content', 'docs');

/**
 * The one `caf` invocation's report, kept so the two tests that need verdicts
 * share a single process. See `lintEveryManifest`.
 */
let cachedReport = null;

/** Where to find core. An env seam, and the only one. */
const CORE_PATH = process.env.CORE_PATH ?? resolve(root, '..', 'core');

/** The `caf` binary. An env seam, and the only one. */
const CAF = process.env.CAF ?? 'caf';

/** Every content file, in a stable order so a failure names one file at a time. */
function contentFiles(dir = docs, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) contentFiles(full, out);
    else if (/\.mdx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Every ```yaml fence, with the line it starts on. */
function manifestFences() {
  const found = [];
  for (const file of contentFiles()) {
    const source = readFileSync(file, 'utf8');
    const rel = file.slice(root.length + 1);
    for (const m of source.matchAll(/^```yaml\n([\s\S]*?)^```/gm)) {
      found.push({
        body: m[1],
        where: `${rel}:${source.slice(0, m.index).split('\n').length}`,
      });
    }
  }
  return found;
}

/**
 * Write every manifest this tier validates into ONE scratch tree, and lint the
 * tree with ONE `caf contract lint`.
 *
 * `caf` is invoked, never reimplemented. It exits 0 when every manifest in the
 * tree is valid and nonzero with a reason for the first invalid one, which is
 * the whole contract this file depends on — and it prints **one line per
 * document**, which is what lets a single invocation still answer per manifest.
 *
 * The layout is not decoration. caf's walk (`internal/contract/lint.go`) only
 * picks up files named exactly `cafaye.yml`, so each documented example gets
 * its own directory; and it treats the manifest at the root of the tree as that
 * repository's own, so this repository's own `cafaye.yml` goes at the root and
 * keeps the adjacency rule it has always had. See the header for why a fence is
 * not linted as a repository.
 *
 * Returns the report and the tree, and the caller deletes the tree. The report
 * is memoized at module scope because two tests below read it and one spawn
 * that answers for both is the entire point of this function; `node --test` runs
 * the tests in a file in order, so the first one to ask pays for it. The memo
 * holds parsed strings rather than anything on disk, so deleting the tree does
 * not invalidate it and either test can clean up first.
 */
function lintEveryManifest() {
  if (cachedReport) return cachedReport;

  const dir = mkdtempSync(join(tmpdir(), 'docs-contracts-'));
  try {
    const manifests = manifestFences();
    // Asserted non-zero: an extractor that stopped matching would turn the
    // strongest check in this repository into a pass over nothing.
    assert.ok(manifests.length > 0, 'no ```yaml manifest fences found — the extractor changed shape');

    // One directory per example, each holding the one filename caf's walk
    // recognises. `where` is the doc position the fence came from, and it is
    // what a failure message leads with: a reader needs `contracts.md:22`, not
    // a temporary directory name.
    const expected = new Map();
    for (const [index, fence] of manifests.entries()) {
      const example = join(dir, `example-${index}`);
      const manifest = join(example, 'cafaye.yml');
      mkdirSync(example);
      writeFileSync(manifest, fence.body);
      expected.set(dirname(manifest), fence.where);
    }

    // This repository's own manifest, byte for byte, at the root of the tree so
    // caf lints it as a repository's own — the way it was linted when it was a
    // separately named file. The copy is compared rather than assumed: a
    // drifted copy would mean this tier validates something other than the file
    // in the repository, which is the one thing it exists not to do.
    const own = readFileSync(join(root, 'cafaye.yml'));
    writeFileSync(join(dir, 'cafaye.yml'), own);
    assert.deepEqual(
      readFileSync(join(dir, 'cafaye.yml')),
      own,
      'the scratch copy of this repository\'s cafaye.yml is not byte-identical to the file',
    );
    expected.set(dir, 'cafaye.yml (this repository\'s own manifest)');

    cachedReport = { dir, expected, ...runCafLint(CAF, dir) };
    return cachedReport;
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Run `caf contract lint` once, and read its report back as one verdict per
 * manifest.
 *
 * Keyed by **directory**, which is unique per manifest by the layout above and
 * needs no guesswork about colons in paths or messages. A line that is not a
 * verdict is kept rather than dropped: caf's own error text (`no cafaye.yml
 * found under …`) is how a broken invocation explains itself, and the tests
 * below put it in the failure message.
 */
function runCafLint(cafBinary, dir) {
  let stdout = '';
  let status = 0;
  let stderr = '';
  try {
    stdout = execFileSync(cafBinary, ['contract', 'lint', dir], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    // Nonzero exit is a normal outcome here — it is how caf reports an invalid
    // manifest — so the report is still parsed out of stdout and the exit code
    // is not itself the verdict.
    stdout = err.stdout ?? '';
    stderr = err.stderr ?? '';
    status = typeof err.status === 'number' ? err.status : 1;
  }

  const verdicts = new Map();
  const unparsed = [];
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    const match = /^(OK|INVALID) (.+)$/.exec(line);
    if (!match) {
      unparsed.push(line.trim());
      continue;
    }
    const ok = match[1] === 'OK';
    // `INVALID <path>: <the first error>` — the first `": "` after the verdict
    // separates path from reason. A cafaye temp path cannot contain one, and
    // the reason is allowed to.
    const cut = ok ? -1 : match[2].indexOf(': ');
    const path = ok ? match[2] : cut === -1 ? match[2] : match[2].slice(0, cut);
    const message = ok ? '' : cut === -1 ? `INVALID with no reason: ${match[2]}` : match[2].slice(cut + 2);
    verdicts.set(dirname(path), { ok, message, raw: line });
  }
  return { verdicts, unparsed, stderr, status };
}

/**
 * Assert caf reported one verdict for every manifest written, and say what it
 * printed when it did not.
 *
 * This is the assertion that keeps the parse honest. One invocation over a tree
 * means the tier's coverage is now a property of caf's *output format* rather
 * than of its exit code per file, and a format that stops matching would
 * otherwise leave this tier green over zero checked manifests — the failure the
 * header calls the false green. A `caf` that rewords a line fails here, with
 * its own output quoted, which is what the next reader needs.
 */
function assertOneVerdictPerManifest(report) {
  const { dir, expected, verdicts, unparsed, stderr } = report;
  const said = [...verdicts.keys()].map((path) => path.slice(dir.length + 1) || '.');
  const wrote = [...expected.keys()].map((path) => path.slice(dir.length + 1) || '.');
  assert.deepEqual(
    said.sort(),
    wrote.sort(),
    `caf contract lint reported ${verdicts.size} verdicts for the ${expected.size} manifests it was ` +
      `given, so this tier cannot say which of them passed. caf exited ${report.status}.\n` +
      `  reported: ${said.join(', ') || '(none)'}\n` +
      `  written:  ${wrote.join(', ')}\n` +
      `  caf said: ${[...unparsed, stderr].join(' | ').trim() || '(nothing)'}\n` +
      '  If caf changed the shape of its report, fix the parser here — do not lower this assertion.',
  );
  return verdicts;
}

test('core is on disk, so this tier can actually run', () => {
  // The first test, and the reason the file cannot be a skip: if core is
  // missing, every assertion below would be an assertion about nothing, and the
  // suite would exit 0 having checked no manifest at all. A local developer
  // with no sibling checkout gets a message that says exactly what to do, and
  // the build is red rather than green.
  assert.ok(
    existsSync(join(CORE_PATH, 'schemas', 'cafaye.manifest.schema.json')),
    `core is not readable at ${CORE_PATH}. This tier reads core's real manifest ` +
      'schema and cannot run without it. Set CORE_PATH, or put core next to this ' +
      'worktree. **This is deliberately a failure and not a skip** — a contract ' +
      'check that cannot find the contract is worse than no contract check, ' +
      'because it converts an unknown into a green badge.',
  );
});

test('caf is on PATH, so the manifest examples can be validated for real', () => {
  // Same reasoning as the check above, for the other prerequisite. Reported
  // separately so a missing toolchain is named as a missing toolchain rather
  // than as a manifest that failed to validate.
  let ok = true;
  let message = '';
  try {
    execFileSync(CAF, ['version'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    ok = false;
    message = String(err.stderr ?? err.message ?? '').split('\n')[0];
  }
  assert.ok(
    ok,
    `the caf binary (${CAF}) could not be run: ${message}\n` +
      'This tier validates manifest examples with the real `caf contract lint` rather ' +
      'than a second implementation of it. Build it from a checkout of cafaye/caf ' +
      '(`go build ./cmd/caf`) and put it on PATH, or set CAF to its path.',
  );
});

test('every cafaye.yml example in the docs passes the real caf validator', () => {
  const report = lintEveryManifest();
  try {
    const verdicts = assertOneVerdictPerManifest(report);
    const rejected = [];
    for (const [dir, where] of report.expected) {
      // The root of the tree is this repository's own manifest, which has its
      // own test below. Asserted on the fences only, exactly as before.
      if (dir === report.dir) continue;
      const verdict = verdicts.get(dir);
      if (!verdict.ok) rejected.push(`${where}: ${verdict.message}`);
    }

    assert.deepEqual(
      rejected,
      [],
      `documented manifests the real validator rejects: ${rejected.join('; ')}. ` +
        'An example that contradicts a shipped contract is a bug in the documentation, ' +
        'and it is the bug a self-hoster hits first.',
    );
    console.log(`    # manifests validated by caf contract lint: ${report.expected.size - 1}`);
  } finally {
    rmSync(report.dir, { recursive: true, force: true });
  }
});

test("this repository's own cafaye.yml passes the real caf validator", () => {
  // The manifest in this repository, held to the same validator as the ones in
  // the prose. `getting-started.md` tells a reader to run `caf contract lint`
  // against a manifest and quotes the output; if this repository's own manifest
  // did not lint clean, the page would be telling a reader to trust a tool on a
  // file that fails it.
  assert.ok(existsSync(join(root, 'cafaye.yml')), 'cafaye.yml is missing from this repository');

  const report = lintEveryManifest();
  try {
    assertOneVerdictPerManifest(report);
    // caf's own line, verbatim — `gate.yml`'s `caf-lint-output` proof is
    // anchored on it and exists precisely because nothing else but the real
    // binary can print `OK <path>/cafaye.yml`.
    const verdict = report.verdicts.get(report.dir);
    assert.ok(
      verdict.ok,
      `this repository's own cafaye.yml does not validate: ${verdict.message || `caf exited ${report.status}`}`,
    );
    console.log(`    # ${verdict.raw}`);
    // caf printed a path under a temporary directory, which is a name no reader
    // can act on. Restated as the file in the repository it was copied from.
    console.log(`    #   ^ cafaye.yml in this repository, linted as the tree's own manifest`);
  } finally {
    rmSync(report.dir, { recursive: true, force: true });
  }
});

test('every event type the docs declare as published has a catalog row in core', () => {
  // The prose names event types constantly — "identity declares five types and
  // writes ten" — and those names are claims about core's catalog. A catalog
  // row that is renamed or removed leaves the sentence confidently wrong and
  // nothing in the build notices.
  //
  // **Both sides are read, neither is written here.** The types the docs
  // mention are extracted from the prose; the set core actually publishes is
  // read out of core's own event-naming document. A hand-typed list would be a
  // list with assertions on it, which is the thing the packet says not to
  // build.
  //
  // **And this checks one direction only, which took a failure to get right.**
  // The first version of this test asserted that *every* three-segment token in
  // the prose has a catalog row, and it went red on six tokens. All six were
  // correct prose:
  //
  //   - `muse.provider.call`, `identity.db.query`, `courier.email.deliver` are
  //     **span names** in observability.md, not event types. They obey a
  //     different contract — core's `span-naming.schema.json` — which has its
  //     own test below. Conflating the two grammars is how a check of this
  //     shape gets deleted.
  //   - `identity.oidc_client.created`, `.revoked` and `identity.member.accepted`
  //     are in **topology.md's drift sections** — "Cross-repo drift audit" and
  //     "The drift the linter cannot see" — whose entire purpose is to record
  //     that core publishes no row for them. A test that flagged them was
  //     flagging the page doing its job.
  //
  // So the assertion is scoped structurally, not lexically: a **section whose
  // heading is about drift** is where this site says what is *wrong*, and it is
  // excluded from a check about what is *right*. The first attempt excluded it
  // by scanning each line for a claim-verb, and that failed too, because one
  // drift row says "It declares **five** types" and lists the three that are
  // not among them in the same sentence. A section is the unit here, and a
  // section boundary is something a reader can see in the rendered page.
  const catalogPath = join(CORE_PATH, 'docs', 'event-naming.md');
  assert.ok(existsSync(catalogPath), `core's event catalog is not readable at ${catalogPath}`);

  const catalog = readFileSync(catalogPath, 'utf8');
  const published = new Set([...catalog.matchAll(/`([a-z_]+\.[a-z_]+\.[a-z_]+)`/g)].map((m) => m[1]));
  assert.ok(published.size > 0, 'parsed no event types out of core catalog — the format changed');

  // A type the docs assert exists. Two filters, and the first one is the
  // load-bearing one.
  //
  //   1. **Not in a drift section.** A heading whose text is about drift,
  //      audit, or what is unwired is where this site records what is wrong.
  //      `topology.md` has two such sections and both are excluded, by name
  //      and by heading, so adding a third drift section is a one-line change
  //      here rather than a surprise failure.
  //   2. **On a line that makes a claim.** The verbs are core's own: a type is
  //      published when a service declares it in `exposes.events`, and a page
  //      says so with "declares", "emits" or "publishes". This filter is only
  //      sound *because* of (1) — see the header for the row that defeated it.
  const DRIFT_SECTION = /^#{2,3} .*(drift|not wired|what does not exist|not built|is not)/im;
  const CLAIM = /\b(declares|declared|declaring|emits|emitted|publishes|published|exposes)\b/i;

  const services = new Set([...published].map((t) => t.split('.')[0]));
  const claims = new Map();
  for (const file of contentFiles()) {
    const source = readFileSync(file, 'utf8');
    const rel = file.slice(root.length + 1);
    let inDrift = false;
    for (const [index, text] of source.split('\n').entries()) {
      if (/^#{1,6} /.test(text)) inDrift = DRIFT_SECTION.test(text);
      if (inDrift || !CLAIM.test(text)) continue;
      for (const m of text.matchAll(/`([a-z][a-z0-9]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)`/g)) {
        const type = m[1];
        // Not a cafaye service at all: a filename or a hostname that happened
        // to match the three-segment shape.
        if (!services.has(type.split('.')[0])) continue;
        if (!claims.has(type)) claims.set(type, `${rel}:${index + 1}`);
      }
    }
  }

  // Reported, and asserted non-zero: a filter that matched nothing would make
  // this a green tick over an empty set, which is the failure mode the fleet
  // names for an iterated-zero-times table.
  assert.ok(
    claims.size > 0,
    'no event-type claims found in the docs — the extractor or the filter changed shape, ' +
      'and this assertion is now checking nothing',
  );

  const unknown = [...claims].filter(([type]) => !published.has(type));
  assert.deepEqual(
    unknown.map(([type, where]) => `${type} (${where})`),
    [],
    `event types a page says a service declares, that core's catalog does not publish: ` +
      `${unknown.map(([t, w]) => `${t} (${w})`).join('; ')}`,
  );
  console.log(
    `    # event-type claims checked against core's catalog: ${claims.size} ` +
      `(core publishes ${published.size})`,
  );
});

test('every span name in observability.md obeys core span-naming schema', () => {
  // The other grammar, checked against the other schema — and this one *can* be
  // fully mechanical in both directions, which is why it is worth having
  // separately rather than folded into the event-type check.
  //
  // observability.md's span-name section is a list of "Good:" names and a list
  // of "Never:" names. Both halves are claims about the same pattern: the good
  // ones must satisfy core's `spanName` pattern, and the never-ones must fail
  // it. A renamed or relaxed pattern in core turns both halves false, and a
  // documentation page teaching a wrong grammar is the exact rot this packet is
  // about — so the pattern is read from core's schema rather than restated.
  const schemaPath = join(CORE_PATH, 'schemas', 'telemetry', 'span-naming.schema.json');
  assert.ok(existsSync(schemaPath), `core's span-naming schema is not readable at ${schemaPath}`);

  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const pattern = schema?.$defs?.spanName?.pattern;
  assert.ok(
    typeof pattern === 'string',
    "core's span-naming schema has no $defs.spanName.pattern — the schema changed shape " +
      'and this test is now reading nothing',
  );
  const spanName = new RegExp(pattern);

  const page = readFileSync(join(docs, 'observability.md'), 'utf8');
  // The heading is matched rather than sliced at a fixed offset, so a new
  // section inserted above it does not silently turn this into a search of the
  // wrong part of the page.
  const heading = page.match(/^## Span names$/m);
  assert.ok(heading, 'observability.md has no "## Span names" section — the page changed shape');
  const section = page.slice(heading.index + heading[0].length);

  /**
   * The code spans the page lists under `marker`, following Markdown line
   * wrapping.
   *
   * The wrapped-line handling is load-bearing rather than cosmetic: the "Good:"
   * run is one sentence broken across two source lines, and an earlier version
   * of this function read only the first line and reported **3 good, 1
   * rejected** where the page lists six and four. A check that silently
   * examines half its input is worse than no check, because the count it
   * prints looks like coverage. The number this prints is now 6 and 4, and it
   * is asserted below against the page rather than trusted.
   */
  const listed = (marker) => {
    const lines = section.split('\n');
    const index = lines.findIndex((l) => l.includes(marker));
    assert.ok(index >= 0, `observability.md has no "${marker}" line — the page changed shape`);

    // The marker sits mid-line, so the spans before it on that line count too.
    const names = [...lines[index].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    for (const line of lines.slice(index + 1)) {
      if (line.trim() === '' || /^\*\*/.test(line.trim())) break;
      names.push(...[...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
    }
    return names;
  };

  const good = listed('**Good:**');
  const never = listed('**Never:**');
  // Both asserted non-zero, and the good-list asserted to hold at least the
  // page's own six examples: a page that stopped listing examples, or a
  // re-wrapped list this function half-reads again, is a failure rather than a
  // smaller green number.
  assert.ok(
    good.length >= 6,
    `observability.md should list at least six "Good:" span names; parsed ${good.length}. ` +
      'A wrapped list is being half-read — fix the extractor, do not lower this number.',
  );
  assert.ok(never.length >= 4, `observability.md should list at least four "Never:" examples; parsed ${never.length}.`);

  // The good ones must match. A prose example that is not a span name at all
  // (`GET /users/:id`) is a shape error, not a naming error, so it is held to
  // the weaker and still true claim: it does not match.
  const badGood = good.filter((name) => !spanName.test(name));
  assert.deepEqual(
    badGood,
    [],
    `span names observability.md recommends that core's span-naming schema rejects: ` +
      `${badGood.join(', ')}. The pattern is core's; if it moved, this page teaches the ` +
      'wrong grammar and the fix is here.',
  );

  // The never-ones must NOT match — including the non-span-name shapes, which
  // is the point of listing them.
  const wronglyGood = never.filter((name) => spanName.test(name));
  assert.deepEqual(
    wronglyGood,
    [],
    `examples observability.md says are invalid that core's span-naming schema accepts: ` +
      `${wronglyGood.join(', ')}. Either the page is wrong or the pattern is.`,
  );
  console.log(`    # span names checked against core's pattern: ${good.length} good, ${never.length} rejected`);
});

/**
 * What core's `fleet.yml` says each service exports, read out of core's file.
 *
 * No YAML dependency, and deliberately so: this repository's rule is that Astro
 * and Starlight are the only two, and a parser is a dependency. `fleet.yml` is
 * core's own hand-maintained transcription with one shape — a `telemetry:`
 * block per service carrying an inline `signals: [...]` — so it is read
 * directly and the parse is **required to find a block for every service in the
 * file**. A regex that quietly matched nothing would report "no service exports
 * anything", every row in the table would then be checked against a fiction, and
 * the suite would be green about nothing: the same shape as the "0 pass, 0 fail"
 * failure the suite-size guard in ci.yml exists to catch.
 */
function coreExportedSignals() {
  const path = join(CORE_PATH, 'fleet.yml');
  assert.ok(
    existsSync(path),
    `core's fleet.yml is not readable at ${path}. This is the machine-readable record of ` +
      'which services export which signals, and the per-service table on ' +
      'observability.md is checked against it. Set CORE_PATH.',
  );
  const source = readFileSync(path, 'utf8');
  const found = new Map();

  // One block per `- name:`, so the split is on the file's own structure rather
  // than on indentation guesses. Spaces, never `\s`, in the structural
  // positions: `\s` matches a newline, so `^\s{2}` will happily match a blank
  // line and the block boundary stops meaning anything.
  for (const block of source.split(/^ {2}- name: /m).slice(1)) {
    const name = block.slice(0, block.indexOf('\n')).trim();
    assert.ok(
      /^ {4}telemetry:[ \t]*$/m.test(block),
      `core's fleet.yml has no \`telemetry:\` block for ${name}. core's own suite asserts ` +
        'one exists, so either the file moved or the extractor here is wrong. Neither may ' +
        'be answered by skipping the comparison.',
    );
    const signals = /^ {6}signals:[ \t]*\[([^\]]*)\][ \t]*$/m.exec(block);
    assert.ok(
      signals,
      `core's fleet.yml has a telemetry block for ${name} with no inline \`signals: [...]\` ` +
        'line. The extractor here reads exactly that shape; fix the extractor or the ' +
        'file, never lower this assertion.',
    );
    found.set(
      name,
      signals[1]
        .split(',')
        .map((one) => one.trim())
        .filter(Boolean),
    );
  }

  const declared = [...source.matchAll(/^ {2}- name: (\S+)$/gm)].map((m) => m[1]);
  assert.ok(
    declared.length > 0 && found.size === declared.length,
    `read ${found.size} telemetry blocks out of ${declared.length} services in core's fleet.yml. ` +
      'A partial parse would make the comparison below a comparison against a fiction.',
  );
  return found;
}

test('the per-service telemetry table agrees with core fleet.yml', () => {
  // WHY THIS TIER, AND WHY THIS FILE. The table on observability.md is the one
  // thing on this site a buyer can act on, and it is a claim about other
  // repositories — which makes it exactly the kind of claim this tier exists to
  // check. It was wrong for a day in the worst way available: three services
  // shipped a wired OTel SDK, `core`'s record said `signals: []`, and the site
  // told buyers "exactly one service exports any signal at all". Nothing in the
  // offline tier can see that, because the sentence is grammatical and the
  // other repository is not on disk.
  //
  // Two directions, because one direction is a check that passes on an empty
  // table: a service core records as exporting traces must appear as
  // instrumented, AND a service the table calls instrumented must be one core
  // records as exporting. The second is the one that catches this packet's
  // subject — the table claiming a capability the fleet record does not have.
  const exported = coreExportedSignals();
  const page = readFileSync(join(docs, 'observability.md'), 'utf8');

  // The table, not the page: the first column of the `## Per service` table.
  const section = /##\s+Per service\b([\s\S]*?)(?=\n##\s|\Z)/.exec(page);
  assert.ok(
    section,
    'observability.md has no `## Per service` section. The per-service table is the ' +
      'part of the page a buyer can act on; this check reads it and cannot read a ' +
      'section that is not there.',
  );

  const rows = new Map();
  for (const line of section[1].split('\n')) {
    // A row's first cell is a service link, or a bare code span for a service
    // that has no page of its own. Both are one name; nothing else is a row.
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const named = /^\[`?([a-z]+)`?\]\(/.exec(cells[0]) ?? /^`([a-z]+)`$/.exec(cells[0]);
    if (!named) continue;
    rows.set(named[1], cells);
  }

  assert.ok(
    rows.size >= exported.size,
    `observability.md's per-service table names ${rows.size} services and core's fleet.yml ` +
      `records ${exported.size} (${[...exported.keys()].join(', ')}). A table shorter than ` +
      'the record cannot be a summary of it.',
  );

  const unrecorded = [];
  const contradicted = [];
  for (const [name, cells] of rows) {
    if (!exported.has(name)) continue; // A service core does not record: nothing to check.
    const claimsInstrumented = /\byes\b/i.test(cells[2]);
    const coreSays = exported.get(name).includes('traces');
    if (claimsInstrumented !== coreSays) {
      contradicted.push(
        `${name}: the table says ${claimsInstrumented ? 'instrumented' : 'not instrumented'}, ` +
          `core's fleet.yml records signals: [${exported.get(name).join(', ')}]`,
      );
    }
    // The third column is `deployed`, and nothing anywhere in the fleet is, so
    // a `yes` in it is a claim core's own file cannot support and this packet
    // has verified to be false.
    if (/\byes\b/i.test(cells[3])) unrecorded.push(name);
  }
  assert.deepEqual(
    contradicted,
    [],
    `the per-service table on observability.md disagrees with core's fleet.yml:\n  ` +
      `${contradicted.join('\n  ')}\n  core is the record; fix the table, or fix fleet.yml ` +
      'and the table in the same commit.',
  );
  assert.deepEqual(
    unrecorded,
    [],
    `the per-service table claims these services are DEPLOYED: ${unrecorded.join(', ')}. ` +
      'No collector is running in any cafaye environment, and nothing in this ' +
      'repository can make that true — so this is a table asserting something no ' +
      'evidence supports.',
  );

  // The other half of the same failure: a *sentence* claiming one service is the
  // only one that exports. That is what three pages carried, it is what core's
  // fleet.yml carried in a `notes` field, and no table check catches it because
  // it is not in the table. Checked against core's record rather than banned
  // outright, so a claim that ever becomes true passes.
  //
  // A CLOSED vocabulary of service-counting claims, not the word "only". The
  // first version matched `only` next to any telemetry word and produced five
  // offenders on correct text: "core owns the contract only", "it exports traces
  // only", "remove the secret only after", `invite-only`, and the shell
  // `export` builtin in a ```sh fence. A guard with that many false positives
  // gets deleted, and a guard nobody trusts is not a guard.
  const exporting = [...exported.keys()].filter((name) => exported.get(name).includes('traces'));
  const EXCLUSIVITY = new RegExp(
    [
      String.raw`\bonly\s+(?:one\s+|other\s+)?(?:cafaye\s+)?service\b`,
      String.raw`\bno\s+other\s+service\b`,
      String.raw`\bexactly\s+one\s+service\b`,
      String.raw`\bsole\s+exporter\b`,
      String.raw`\bthe\s+only\s+(?:exporter|one\s+that\s+export)`,
    ].join('|'),
    // `g` because the paragraph is walked with `matchAll`, so a negated claim and
    // an un-negated one in the same paragraph are separable.
    'gi',
  );
  const TELEMETRY = /\b(?:export|emit|signal|telemetry|trace|observab|collector)\b/i;  // "is NOT the only service the boundary applies to" is a true uniqueness
  // claim, and flagging it is how a guard teaches its author to delete it. A
  // negator within a few words in front of the match clears it, and only that.
  const NEGATED = /\b(?:not|never|no\s+longer|rather\s+than|instead\s+of)\b[^.]{0,12}$/i;
  const offenders = [];
  for (const file of contentFiles()) {
    // Fences go first: a ```sh block's `export FOO=bar` is a shell builtin, and
    // a prose check that reads shell code is a prose check about the wrong
    // language.
    const prose = readFileSync(file, 'utf8').replace(/^```[\s\S]*?^```/gm, '');
    for (const paragraph of prose.split(/\n[ \t]*\n/)) {
      if (!TELEMETRY.test(paragraph)) continue;
      for (const claim of paragraph.matchAll(EXCLUSIVITY)) {
        if (NEGATED.test(paragraph.slice(Math.max(0, claim.index - 24), claim.index))) continue;
        const first = paragraph.trim().split('\n')[0].replace(/\s+/g, ' ').trim();
        offenders.push(`${file.slice(root.length + 1)}: ${first}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a page claims one service is the only one exporting telemetry, and core's fleet.yml ` +
      `records ${exporting.length}: ${exporting.join(', ')}.\n  ${offenders.join('\n  ')}`,
  );

  console.log(
    `    # per-service telemetry rows checked against core's fleet.yml: ${rows.size} rows, ` +
      `${exporting.length} services recorded as exporting traces, ${offenders.length} exclusivity claims`,
  );
});
