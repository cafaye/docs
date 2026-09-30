// astro.config.mjs — the cafaye docs site.
//
// STATUS: scaffold. The site is static (Astro's default, no adapter) and the
// gate is `npm run build`, which runs Starlight's frontmatter validation and
// Astro's content collection checks. A page that does not validate fails the
// build rather than shipping a broken sidebar.
//
// WHAT IS DELIBERATELY ABSENT, and why — read before adding any of it:
//   - `pagefind: false` — the packet forbids search indexing, and Starlight's
//     default is to build a Pagefind index at the end of every build. Turn it
//     on only with a decision to maintain a search index.
//   - no sitemap, no analytics, no blog. A docs site that indexes itself into
//     third-party services is a privacy and maintenance surface we have not
//     agreed to carry.
//
// site: the canonical origin. Every internal link and the sitemap Astro would
// generate resolve against it, so it must be the real one at deploy time.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.cafaye.com',
  trailingSlash: 'ignore',
  integrations: [
    starlight({
      title: 'cafaye',
      description:
        'cafaye — the open-source, multi-language SaaS platform. One CLI, independent services, connected by typed contracts.',
      // No `logo` yet: there is no brand asset in this repository, and an SVG
      // invented here would be a logo the project has not approved.
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/cafaye' }],
      editLink: {
        baseUrl: 'https://github.com/cafaye/docs/edit/master/src/content/docs/',
      },
      credits: true,
      // Starlight injects a /404 route by default, which collides with a
      // catch-all `/[...slug]` over the docs collection. We own /404 ourselves
      // in src/pages/404.astro, so the injected route is turned off rather than
      // left to win a route race and log a warning on every build.
      disable404Route: true,
      // Forbid search indexing (packet: "no search indexing"). See the header.
      pagefind: false,
      lastUpdated: false,
      // The sidebar is a claim about the site: every `slug:` here is resolved by
      // Starlight at build time (a dangling one fails the build) and re-checked
      // against dist/ by tests/smoke.mjs. Add the page and the entry in the same
      // commit, and never one without the other.
      //
      // Section order follows the two readers this site has: someone deciding
      // whether to adopt cafaye (Start here → Architecture → Services), then
      // someone who already did and now has to keep it running (Runbooks →
      // Troubleshooting). `services` is the hub both paths point back at.
      sidebar: [
        { label: 'Home', link: '/' },
        {
          label: 'Start here',
          items: [{ slug: 'getting-started' }, { slug: 'contracts' }],
        },
        {
          label: 'Architecture',
          items: [{ slug: 'architecture' }, { slug: 'architecture/topology' }],
        },
        {
          label: 'Services',
          items: [{ autogenerate: { directory: 'services' } }],
        },
        {
          label: 'Runbooks',
          items: [
            { slug: 'runbooks' },
            { slug: 'runbooks/tenant-provisioning' },
            { slug: 'runbooks/backup-and-restore' },
            { slug: 'runbooks/secret-rotation' },
            { slug: 'runbooks/service-down' },
            { slug: 'runbooks/billing-webhooks' },
          ],
        },
        { slug: 'troubleshooting' },
        { slug: 'guides' },
      ],
    }),
  ],
});