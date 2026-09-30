# Changelog

All notable changes to the cafaye documentation site are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The site is
unversioned at present — it is pre-launch and `package.json` carries `0.0.0`.

## [Unreleased]

### Added

- Initial scaffold of the docs site: Astro 7.3.5 + Starlight 0.42.4, static
  output, no adapter, `site: https://docs.cafaye.com`.
- **Home** (`src/content/docs/index.mdx`) — what cafaye is in one paragraph,
  then the services and tooling tables mirroring the org README, with cards for
  the three entry points.
- **Getting Started** — installing `caf`, `caf init`, `caf dev`. Every command
  that has not shipped is marked *Coming soon* rather than presented as working.
- **Services** — an overview page and one page each for `identity`, `billing`,
  `courier`, `darkroom`, `muse`, `guard`, and `parlor`. Each page states the
  language, the role, and a status line saying what is built and what is not,
  sourced from PLAN.md §tree and each service's own README.
- **Contracts** — the `cafaye.yml` manifest format, the event envelope, and
  OpenAPI, summarized with links to `cafaye/core`, which is named as the source
  of truth.
- **Guides** — a placeholder that says so, and explains why no guide is written
  against commands that do not run yet.
- `/404` (`src/pages/404.astro`) with `disable404Route: true`, so this
  repository owns the route instead of colliding with Starlight's injected one.
- `bin/prime` — the gate: `npm ci && npm run build && npm test`.
- `tests/smoke.mjs` — asserts `dist/index.html` exists and is a non-empty HTML
  document, that every sidebar slug has a source file and reached `dist/`
  (expectations read from `astro.config.mjs`, not hardcoded), and that the
  services directory is not empty.
- `README.md` with run and deploy instructions, `AGENTS.md` with the
  conventions, `CHANGELOG.md`, `.gitignore`, `mise.toml` (node 22.19.0 — above
  Astro 7's 22.12.0 floor, so `npm ci` prints no engine warnings), and a draft
  `cafaye.yml` validated against core's manifest schema.

### Notes

- **Search indexing is off** (`pagefind: false`) and no analytics are present.
  Starlight ships `@astrojs/sitemap`, so the build emits `sitemap-index.xml`;
  that was not treated as "search indexing" to remove.
- No blog, no CI workflow, no lint or typecheck step. The build is the gate.
- `cafaye.yml` records one open decision for the manager:
  `language: typescript` for a static site, because core's `language` enum has
  no value for it.