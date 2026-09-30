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
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const docs = join(root, 'src', 'content', 'docs');

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
 * Run `caf contract lint` on one manifest and return its verdict.
 *
 * `caf` is invoked, never reimplemented. It exits 0 for a valid manifest and
 * nonzero with a reason for an invalid one, which is the whole contract this
 * file depends on.
 */
function lintManifest(cafBinary, file) {
  try {
    const stdout = execFileSync(cafBinary, ['contract', 'lint', file], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { ok: true, message: stdout.trim() };
  } catch (err) {
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
    return { ok: false, message: output || `exited ${err.status}` };
  }
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
  const dir = mkdtempSync(join(tmpdir(), 'docs-contracts-'));
  try {
    const manifests = manifestFences();
    // Asserted non-zero: an extractor that stopped matching would turn the
    // strongest check in this repository into a pass over nothing.
    assert.ok(manifests.length > 0, 'no ```yaml manifest fences found — the extractor changed shape');

    const rejected = [];
    for (const [index, fence] of manifests.entries()) {
      const file = join(dir, `example-${index}.yml`);
      writeFileSync(file, fence.body);
      const verdict = lintManifest(CAF, file);
      if (!verdict.ok) rejected.push(`${fence.where}: ${verdict.message}`);
    }

    assert.deepEqual(
      rejected,
      [],
      `documented manifests the real validator rejects: ${rejected.join('; ')}. ` +
        'An example that contradicts a shipped contract is a bug in the documentation, ' +
        'and it is the bug a self-hoster hits first.',
    );
    console.log(`    # manifests validated by caf contract lint: ${manifests.length}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("this repository's own cafaye.yml passes the real caf validator", () => {
  // The manifest in this repository, held to the same validator as the ones in
  // the prose. `getting-started.md` tells a reader to run `caf contract lint`
  // against a manifest and quotes the output; if this repository's own manifest
  // did not lint clean, the page would be telling a reader to trust a tool on a
  // file that fails it.
  const manifest = join(root, 'cafaye.yml');
  assert.ok(existsSync(manifest), 'cafaye.yml is missing from this repository');

  const verdict = lintManifest(CAF, manifest);
  assert.ok(verdict.ok, `this repository's own cafaye.yml does not validate: ${verdict.message}`);
  console.log(`    # ${verdict.message}`);
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
