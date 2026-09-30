#!/usr/bin/env node
// tests/smoke.mjs — the whole test suite for the docs site.
//
// WHY THIS FILE IS THE ENTIRE SUITE
//   The docs repository has no runtime: it is Markdown plus a build. The only
//   thing that can break is the build, and the build is the gate
//   (`bin/prime` = `npm ci && npm run build && npm test`). So this test's job
//   is to assert that a build actually produced a site, and specifically the
//   pages the navigation in astro.config.mjs promises. A green `npm run build`
//   with an empty dist/ would otherwise pass silently.
//
// WHAT IT ASSERTS (and what it deliberately does not)
//   - dist/index.html exists, is non-empty, and is an HTML document.
//   - Every page linked from the sidebar has a source file AND reached dist/.
//     Starlight does fail the build on a dangling sidebar slug, so this is
//     deliberately redundant with the build: it names the broken slug in one
//     line, and it still catches a page that built but was never emitted.
//   - No HTML snapshot, no assertion on prose. A snapshot is a test that fails
//     on every copy edit and gets deleted within a week, which is worse than
//     no test. Content correctness is the author's job, checked in review.
//
// SIDEBAR DERIVATION — why this file parses astro.config.mjs instead of
// hardcoding the page list
//   A hardcoded list is a second source of truth that drifts: add a sidebar
//   entry, forget this file, and the test quietly stops checking the new page.
//   So the expected routes are read from the config, the one place a page is
//   actually promised. Every `slug:` there must resolve to a file under
//   src/content/docs/ AND to HTML in dist/.
//
//   The config is read as text rather than imported, on purpose. Importing it
//   would need the Starlight integration resolvable and would execute the
//   integration; reading it keeps `npm test` runnable on its own.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const docs = join(root, 'src', 'content', 'docs');
const configFile = join(root, 'astro.config.mjs');

/**
 * Strip comments and string literals out of a JS source file, so a `slug:`
 * inside a comment cannot become a test assertion. Line comments and block
 * comments only — the config has no regex literals or template strings whose
 * contents matter here.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every `slug: '…'` in the sidebar, plus the literals of any `{ link: '/' }`. */
function sidebarSlugs() {
  const source = stripComments(readFileSync(configFile, 'utf8'));
  const slugs = [...source.matchAll(/slug:\s*'([^']+)'/g)].map((m) => m[1]);
  const links = [...source.matchAll(/\blink:\s*'([^']*)'/g)].map((m) => m[1]);
  return { slugs, links };
}

/**
 * The content file a Starlight slug maps to. Starlight's docsLoader sluggifies
 * the filename and drops the extension, so `services/identity.md` serves
 * `/services/identity/`. Directories get an `index` file.
 */
function sourceFileFor(slug) {
  const base = slug.replace(/^\/+|\/+$/g, '');
  const asFile = base ? join(docs, `${base}.md`) : join(docs, 'index.mdx');
  const asDir = join(docs, base, 'index.md');
  return existsSync(asFile)
    ? asFile
    : existsSync(join(docs, `${base}.mdx`))
      ? join(docs, `${base}.mdx`)
      : asDir;
}

/** The built HTML path for a URL path, matching Astro's default `directory` format. */
function htmlFor(urlPath) {
  const clean = urlPath.replace(/^\/+/, '').replace(/\/+$/, '');
  return clean === '' ? 'index.html' : `${clean}/index.html`;
}

test('dist/index.html exists, is non-empty, and is HTML', () => {
  const index = join(dist, 'index.html');
  assert.ok(
    existsSync(index),
    `dist/index.html missing — run \`npm run build\` before \`npm test\` (looked in ${dist})`,
  );
  assert.ok(statSync(index).size > 0, 'dist/index.html is empty');
  assert.match(readFileSync(index, 'utf8'), /<html/i, 'dist/index.html is not an HTML document');
});

test('every sidebar slug has a page in src/content/docs/', () => {
  const { slugs } = sidebarSlugs();
  assert.ok(slugs.length > 0, 'no sidebar slugs found — did astro.config.mjs change shape?');

  const missing = slugs
    .map((slug) => [slug, sourceFileFor(slug)])
    .filter(([, file]) => !existsSync(file))
    .map(([slug, file]) => `${slug} (looked for ${file})`);

  assert.deepEqual(missing, [], `sidebar slugs with no content file: ${missing.join('; ')}`);
});

test('every sidebar slug is in dist/ after a build', () => {
  const { slugs, links } = sidebarSlugs();
  const routes = [
    ...slugs.map((slug) => `/${slug}/`),
    // `link:` entries are absolute URLs or site-relative paths; an external
    // URL is not our page to build.
    ...links.filter((href) => href.startsWith('/')).map((href) => href),
  ];

  const missing = routes
    .map((route) => [route, htmlFor(route)])
    .filter(([, html]) => !existsSync(join(dist, html)))
    .map(([route, html]) => `${route} -> ${html}`);

  assert.deepEqual(
    missing,
    [],
    `sidebar routes missing from dist/: ${missing.join(', ')} — run \`npm run build\` first`,
  );
});

test('the services directory is not empty', () => {
  const services = join(docs, 'services');
  assert.ok(existsSync(services), 'src/content/docs/services/ is missing');
  const pages = readdirSync(services).filter((f) => /\.mdx?$/.test(f));
  assert.ok(pages.length > 0, 'no service pages found in src/content/docs/services/');
});