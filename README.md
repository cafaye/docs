# docs

The cafaye documentation site — **docs.cafaye.com**. A static
[Astro](https://astro.build) site with
[Starlight](https://starlight.astro.build), built to a directory of HTML with no
runtime behind it.

**Status: operator documentation for an org in early development.** Two readers:
a design partner onboarding onto their own infrastructure, and an operator who
has to keep it alive. The structure, the gate, and the deploy path are in place.
The content is honest about what the platform does and does not do — every
service page carries a status line that matches its repository, and every
command that has not shipped is marked *Coming soon* with the exact message and
exit code it produces. This repository documents an org in early development; it
is not an API reference.

## The gate

```sh
mise install     # node 22.19.0, pinned in mise.toml
bin/prime        # npm ci && npm run build && npm test
```

`bin/prime` is the whole test suite; there is no separate lint or typecheck
step. The build **is** the gate: Starlight validates every page's frontmatter,
Astro checks every content collection, and Starlight resolves every sidebar slug,
so a page with a missing `title` or a sidebar entry pointing at nothing fails
`npm run build`. `tests/smoke.mjs` then asserts the build produced
`dist/index.html` and every page the sidebar promises — a green build with an
empty `dist/` is the failure this catches. It reads the sidebar out of
`astro.config.mjs` rather than hardcoding the page list, so a new entry cannot
silently escape being checked.

The build is clean: no warnings and no errors. (One Vite notice about a module
level directive in `index.mdx` is Astro's own MDX asset-propagation pass, not a
problem with the page.)

## Running it locally

```sh
npm install      # once; after that bin/prime uses npm ci
npm run dev      # http://localhost:4321
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Build the static site into `dist/` |
| `npm run preview` | Serve `dist/` locally, as the host will |
| `npm test` | The smoke test — **run a build first**, it reads `dist/` |

## Deploy

The output is a plain static directory, so any static host works. There is no
adapter, no server function, and no environment variable read at runtime.

```sh
timeout 600 npm ci
timeout 420 npm run build
# publish dist/ — that is the whole deploy
```

`site:` in `astro.config.mjs` is `https://docs.cafaye.com`, and it must be the
real origin at deploy time: every canonical URL and the sitemap resolve against
it.

### Hosting notes

- **Any static host.** Netlify, Cloudflare Pages, GitHub Pages, S3 + CloudFront,
  or a container that serves `dist/`. Nothing in the build depends on the host.
- **`404.html` is served as the 404 page.** A host needs to be told that
  explicitly (Cloudflare Pages: `_redirects` or a `404.html` convention; nginx:
  `error_page 404 /404.html`). `dist/404.html` is generated.
- **Cache headers.** Astro fingerprints assets under `dist/_astro/`, so those
  are safe to serve as immutable. The HTML files are not — a redeploy changes
  them, and a stale page is a docs site showing the wrong status.
- **`npm ci`, not `npm install`.** The lockfile is what keeps two machines
  building the same site.
- **Node 22.19.0 or newer.** Astro 7's floor is 22.12.0, but a transitive
  dependency (`undici`, via `unifont`) asks for 22.19.0; the pin covers both so
  `npm ci` prints no engine warnings. `engines` in `package.json` and
  `mise.toml` both say so.

### CI

The gate command is `bin/prime`, and that is what CI should run: build plus the
smoke test, no secrets, nothing published. There is no CI workflow in this
repository yet — `kit`'s reusable workflow
(`cafaye/kit/workflows/ci.reusable.yml`) has a `node` job, but it runs
`npm test` without building first, so it would fail here on a clean checkout.
Wiring it up properly is a one-line change to that workflow once kit carries a
"build before test" step; until then the honest options are a job that runs
`bin/prime` directly, or none at all.

## Content

Pages are Markdown and MDX in `src/content/docs/`; the file path is the URL.

```
src/content/docs/
├── index.mdx                 home — what cafaye is, plus the services table
├── getting-started.md        the six-step path: doctor → install → init → local → deploy
├── contracts.md              cafaye.yml, the event envelope, OpenAPI
├── troubleshooting.md        keyed by symptom, not by component
├── architecture/
│   ├── index.md              what each service owns, and why the boundaries
│   └── topology.md           ports, probes, env vars, dependency graph
├── runbooks/
│   ├── index.md              the five, and the two facts they all assume
│   ├── tenant-provisioning.md
│   ├── backup-and-restore.md
│   ├── secret-rotation.md
│   ├── service-down.md
│   └── billing-webhooks.md
├── guides/index.md           what is walkable today, and where it lives
└── services/
    ├── index.md              overview + why one language per service
    └── <service>.md          one page per service
```

- `title` and `description` are **required** frontmatter. A page without them
  fails the build.
- The sidebar lives in `astro.config.mjs` and the services group is
  autogenerated from `src/content/docs/services/`, so a new service page appears
  in the nav on its own.
- `/404` is `src/pages/404.astro`, not a docs page. Starlight injects a `/404`
  route that collides with the catch-all over the docs collection; `disable404Route`
  turns that off so this repository owns one route with no build warning.
- Service pages are written from PLAN.md §tree and the org README. Where they
  describe a service, [that repository's](https://github.com/cafaye) README and
  code are the source of truth — not this page.
- Contract details are owned by
  [cafaye/core](https://github.com/cafaye/core). This site summarizes and links;
  it does not define.

## The accuracy rule, and how it is enforced

**A documented command that does not exist is the worst thing this site can
ship.** A service page that says a command does not ship yet is telling the
truth; one that confidently documents a flag nobody added is worse than an empty
page, because the reader finds out at 2am.

So every command, flag, endpoint, and environment variable on this site is
written from one of these, never from a plausible guess:

1. **A source file.** The `caf` subcommands come from
   `moon/cafaye/caf/internal/cli/*.go`; a flag is documented because the flag
   set declares it.
2. **A machine-readable file.** `cafaye.yml`, `Dockerfile`,
   `docker-compose.yml`, `db/schema.rb`, `openapi/v1.yaml`, `mise.toml`.
3. **A test.** Where a behaviour is subtle, the integration test is the spec.

The v0 commands that do not work are documented *with the exact message and
exit code they produce*, which is more useful to a reader than "Coming soon"
alone: `not implemented in v0` with exit 1 means the command is wired and is a
stub, and exit 2 with `usage:` means the invocation was wrong. Those two are
different problems and a reader who is told only "unavailable" cannot tell them
apart.

### Findings are recorded, not smoothed over

Where a page describes something broken or missing in a cafaye repository, it
says so on the page an operator will hit, with the error they will see. See
[Topology](/architecture/topology.md)'s *Manifest drift you may hit* section and
[Troubleshooting](/troubleshooting.md). The current ones:

- `goose` panics on `identity`'s migrations — two files share version 5 — so the
  command in that repository's own README does not work.
- `GET /v1/accounts/{id}/members` returns only each member's `role`; the ids
  come back empty.
- `caf contract lint` fails on `caf`, `courier`, and `parlor`.

A docs site that hides a known defect is not being honest, it is being
useless.

## Deliberately absent

| Not here | Why |
| --- | --- |
| Search | `pagefind: false`. Starlight would build a Pagefind index on every build; the packet forbids search indexing and a search box over ten pages is noise |
| Analytics | A docs site that phones home is a privacy and maintenance surface |
| Blog | Not asked for, and a second content type to keep honest |
| Sitemap opt-out | `@astrojs/sitemap` ships with Starlight and emits `sitemap-index.xml` automatically. Removing it is a Starlight-side change; not blocked by the packet, which forbids *search indexing*, not a sitemap |
| Lint / typecheck steps | Nothing to lint: two config files, one `.astro` page, and Markdown |

## Layout

```
astro.config.mjs          site URL, Starlight config, the sidebar
src/content.config.ts     Starlight docs collection + an empty i18n collection
src/content/docs/         every page
src/pages/404.astro       /404
tests/smoke.mjs           the whole suite
bin/prime                 the gate
cafaye.yml                the cafaye manifest, so the org tooling finds this repo
mise.toml                 node 22.19.0
```

See [AGENTS.md](AGENTS.md) for the conventions, and
[CHANGELOG.md](CHANGELOG.md) for what changed.