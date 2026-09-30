// tests/examples.mjs — the code examples in the prose, checked.
//
// THE ARGUMENT FOR THIS FILE, in one paragraph
//   Every other repository's tests assert that *code* behaves. This one's only
//   product is prose and the code examples inside it, and prose fails in ways
//   code does not: a `caf` subcommand gets renamed, a manifest key moves, a
//   response field is dropped — and the example keeps rendering perfectly,
//   because nothing compiles a Markdown fence. Those examples were correct when
//   written and they rot silently, because a fence is not a test. This file is
//   the thing that compiles them.
//
// WHAT IS CHECKED MECHANICALLY, and what is not — said out loud because the
// difference is the whole point of the packet:
//
//   MECHANICAL, no network, no sibling checkout:
//     - every ```sh fence parses as shell (`bash -n`)
//     - every ```json fence parses as JSON
//     - every ```yaml fence parses as YAML
//     - every `caf` invocation in a fence names a subcommand `caf help` lists,
//       read from the **vendored help text in this repository's own docs**
//
//   MECHANICAL, needs a sibling checkout (tests/contracts.mjs, not this file):
//     - the two `cafaye.yml` examples validate against core's real schema,
//       through the real `caf contract lint`
//
//   **NOT CHECKED, and deliberately so — do not add a test that "asserts these
//   examples are correct".** A hand-maintained list of known-good examples is
//   a list with assertions on it: it proves the list was not edited, not that
//   the platform matches. The claims in this repository that a human must
//   still check by reading are the prose ones — whether a documented status
//   line is true today, whether a table describes the shape of a service
//   correctly, whether a sentence is honest. See REPORT-docs-05.md.
//
// A NOTE ON WHY `bash -n` AND NOT "RUN THE COMMAND"
//   Running a documented command would need the toolchain the command is for —
//   a Postgres, a Docker daemon, a running identity. That is a network
//   dependency and a service dependency in the unit tier, and the packet
//   forbids it. `bash -n` answers the question that can be answered offline —
//   does this parse — and it is the question that catches the rot, because the
//   rot in a shell example is nearly always a broken line continuation or an
//   unterminated quote left behind by an edit.
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const docs = join(root, 'src', 'content', 'docs');

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

/**
 * Every fenced block, with the language it claims and the line it starts on.
 *
 * The line number is carried into every failure message in this file. A
 * documentation gate that says "invalid JSON in a fence somewhere" is a gate
 * nobody acts on, because the person who has to fix it is looking at a
 * rendered web page and not at a file offset.
 */
function fences() {
  const found = [];
  for (const file of contentFiles()) {
    const source = readFileSync(file, 'utf8');
    const rel = file.slice(root.length + 1);
    for (const m of source.matchAll(/^```(\w*)\n([\s\S]*?)^```/gm)) {
      found.push({
        lang: m[1],
        body: m[2],
        where: `${rel}:${source.slice(0, m.index).split('\n').length}`,
      });
    }
  }
  return found;
}

/**
 * Placeholders a runbook uses on purpose, replaced before a fence is parsed.
 *
 * `<name>` and `<command>` are not shell: `<` is a redirection operator, so
 * `docker logs --tail 200 <name>` is a syntax error to `bash` and a working
 * command to a human. That is a documentation convention, not a bug, and
 * asserting on it would be a test that fails on correct prose.
 *
 * So the convention is **named here and nowhere else**, and a fence that uses a
 * placeholder this function does not know about still fails to parse. That is
 * the difference between handling a convention and hiding a defect: the
 * substitution list is closed, small, and asserted to still be the one this
 * repository uses.
 */
const PLACEHOLDERS = [
  // service name, as the runbooks write it
  [/<name>/g, 'SERVICE'],
  // a `caf` subcommand, in the "a caf command exits 2" entry
  [/<command>/g, 'deploy'],
  // a docker container name and a postgres superuser, in the version-skew trap
  [/<pg-container>/g, 'postgres'],
  [/<superuser>/g, 'postgres'],
];

function substitutePlaceholders(body) {
  let out = body;
  for (const [pattern, replacement] of PLACEHOLDERS) out = out.replace(pattern, replacement);
  return out;
}

const all = fences();

test('every sh fence is syntactically valid shell', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-examples-'));
  try {
    const script = join(dir, 'fence.sh');
    const broken = [];
    const shell = all.filter((f) => f.lang === 'sh');
    // Asserted non-zero: a fence extractor that stopped matching would make
    // this test a pass over nothing, which is the failure mode the fleet calls
    // out by name.
    assert.ok(shell.length > 0, 'no ```sh fences found — the extractor changed shape');

    for (const fence of shell) {
      writeFileSync(script, substitutePlaceholders(fence.body));
      try {
        // `bash -n` reads and parses without executing. Nothing in a Markdown
        // fence is ever run by this suite.
        execFileSync('bash', ['-n', script], { stdio: 'pipe' });
      } catch (err) {
        const message = String(err.stderr ?? '').split('\n').find((l) => /syntax error/.test(l));
        broken.push(`${fence.where}: ${message?.trim() ?? 'does not parse'}`);
      }
    }

    assert.deepEqual(
      broken,
      [],
      `shell examples that do not parse: ${broken.join('; ')}. A fence is not a test, ` +
        'so a broken line continuation or an unterminated quote survives every other check here.',
    );
    console.log(`    # sh fences parsed: ${shell.length}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every json fence is valid JSON', () => {
  const json = all.filter((f) => f.lang === 'json');
  assert.ok(json.length > 0, 'no ```json fences found — the extractor changed shape');

  const broken = [];
  for (const fence of json) {
    try {
      JSON.parse(fence.body);
    } catch (err) {
      broken.push(`${fence.where}: ${err.message.split('\n')[0]}`);
    }
  }

  assert.deepEqual(
    broken,
    [],
    `json examples that do not parse: ${broken.join('; ')}. A response body shown with a ` +
      'comment in it, or two documents in one fence, is not a body a reader can send.',
  );
  console.log(`    # json fences parsed: ${json.length}`);
});

test('every yaml fence is a manifest this repository can actually validate', () => {
  // There is deliberately **no YAML parser in this tier**, and the reason is
  // worth stating because the obvious version of this test is wrong twice.
  //
  // First: `js-yaml` is in the tree, but only as a **transitive** dependency of
  // Astro and Starlight. AGENTS.md's rule is that Astro and Starlight are the
  // only two dependencies and adding one is a decision about what this project
  // carries — so a gate that reaches into somebody else's dependency tree is
  // a gate that breaks on an unrelated upgrade, for a check that is weaker
  // than the one already built.
  //
  // Second, and this is the part that decided it: a "does this parse" test is
  // the wrong question. Both ```yaml fences in this site are `cafaye.yml`
  // manifests, so the question worth asking is not *is this well-formed YAML*
  // but *does the real validator accept it* — and that check exists, in
  // tests/contracts.mjs, running the real `caf contract lint` against core's
  // real schema. A syntax check here would be a second, weaker answer to a
  // question that already has the right answer one file over.
  //
  // So this asserts the shape of the claim instead: that a yaml fence exists,
  // that it is the manifest vocabulary, and that contracts.mjs is the file
  // that validates it. If a third yaml fence appears that is *not* a manifest
  // — a compose file, a CI config — this test says so rather than silently
  // widening.
  const yaml = all.filter((f) => f.lang === 'yaml');
  assert.ok(yaml.length > 0, 'no ```yaml fences found — the extractor changed shape');

  const notManifests = yaml
    .filter((f) => !/^\s*name:\s*\S+/m.test(f.body) || !/^\s*language:\s*\S+/m.test(f.body))
    .map((f) => f.where);

  assert.deepEqual(
    notManifests,
    [],
    `yaml fences that are not cafaye.yml manifests: ${notManifests.join('; ')}. If a ` +
      'non-manifest yaml example was added, it needs its own check rather than the ' +
      'manifest one in tests/contracts.mjs.',
  );
  console.log(`    # yaml fences (all validated by tests/contracts.mjs): ${yaml.length}`);
});

test('every caf invocation in a fence names a subcommand caf help lists', () => {
  // The specific rot the packet describes: a subcommand is renamed or a
  // command is added, and the example keeps working in the reader's head and
  // failing in their terminal.
  //
  // The vocabulary is **not** a list written out here. It is read out of the
  // `caf help` output this repository already quotes in
  // `getting-started.md`, so there is exactly one place in this repository that
  // says what `caf` can do, and an example that invents a command fails
  // against it. A hardcoded list would be a second source of truth that drifts
  // silently — the exact defect tests/smoke.mjs's header refuses to accept for
  // the sidebar.
  const helpFence = all.find(
    (f) => f.lang === '' && f.body.includes('caf - the cafaye platform CLI'),
  );
  assert.ok(
    helpFence,
    'could not find the quoted `caf help` output in the docs. This test reads the ' +
      'command vocabulary from it rather than from a list of its own; if the quote ' +
      'moved, fix this test to point at the new location rather than pasting the ' +
      'list in here.',
  );

  // The `Commands:` block of `caf help`, indented two spaces, name then spaces.
  const block = helpFence.body.slice(helpFence.body.indexOf('Commands:'));
  const commands = new Set(
    [...block.matchAll(/^ {2}(\w+)\s{2,}\S/gm)].map((m) => m[1]),
  );
  // `contract` has subcommands of its own, so both it and they are legal.
  for (const sub of ['lint', 'resolve']) commands.add(`contract ${sub}`);
  assert.ok(commands.size >= 9, `parsed only ${commands.size} commands out of caf help`);

  // Every `caf <word>` that starts a command inside a shell fence.
  //
  // **Only the first word after `caf` is the subcommand**, and that is the
  // detail this got wrong first. `caf deploy identity` is `deploy` with a
  // positional argument, and `caf help init` is `help` with a positional
  // argument; reading the second word as part of the name produced two
  // failures against correct examples, which is how a check of this shape
  // gets deleted. `contract` is the one command in `caf` that owns
  // subcommands, so it is the only one where a second word is part of the
  // name — and it is taken from the help text's own list rather than assumed.
  const used = new Map();
  for (const fence of all) {
    if (fence.lang !== 'sh') continue;
    for (const m of fence.body.matchAll(/(?:^|[;&|]\s*|\$\s)caf\s+([a-z]+)(?:\s+([a-z]+))?/gm)) {
      const [, first, second] = m;
      // A second word is a subcommand only under `contract`; anywhere else it
      // is the command's positional argument and not part of its name.
      const name = first === 'contract' && second ? `contract ${second}` : first;
      if (name === 'help') continue;
      if (!used.has(name)) used.set(name, fence.where);
    }
  }
  assert.ok(used.size > 0, 'no `caf` invocations found in any sh fence');

  const invented = [...used]
    .filter(([name]) => !commands.has(name))
    .map(([name, where]) => `${name} (${where})`);

  assert.deepEqual(
    invented,
    [],
    `caf invocations naming a subcommand caf help does not list: ${invented.join('; ')}. ` +
      'If the command is real, the quoted help output in getting-started.md is stale.',
  );
  console.log(
    `    # caf subcommands referenced: ${used.size}, vocabulary from the quoted help: ${commands.size}`,
  );
});

test('the placeholder convention this file substitutes for is the one the docs use', () => {
  // The substitution list above is a closed convention. This asserts it is
  // still the convention, so it cannot quietly grow to cover whatever breaks
  // next: a fence using an angle-bracket placeholder nobody declared fails
  // `bash -n` in the first test, loudly, and that failure is the signal to add
  // the placeholder here **on purpose** rather than to widen the substitution.
  const unknown = [];
  for (const fence of all) {
    if (fence.lang !== 'sh') continue;
    for (const m of fence.body.matchAll(/<([a-z][a-z-]*)>/g)) {
      const token = m[0];
      if (!PLACEHOLDERS.some(([pattern]) => new RegExp(pattern.source).test(token))) {
        unknown.push(`${fence.where}: ${token}`);
      }
    }
  }
  assert.deepEqual(
    unknown,
    [],
    `angle-bracket placeholders in shell examples that tests/examples.mjs does not ` +
      `declare: ${unknown.join('; ')}. Add it to PLACEHOLDERS with a reason, or write the ` +
      'example so bash can parse it.',
  );
});
