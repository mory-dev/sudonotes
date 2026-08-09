# sudonotes.com

The marketing and docs site. Astro and static output. Documentation content and navigation work
without client-side JavaScript; small progressive enhancements provide local search, in-page find,
active headings, and copy buttons.

```bash
cd site && npm install && npm run dev
```

```bash
cd site && npm run build
```

Output goes to `dist/`.

## The UI previews are recreations, not screenshots

`src/components/*Preview.astro` rebuild the app's interface in HTML and CSS,
using the same design tokens as `app/src/App.css`, filled with **mock data** from
`src/data/vault.ts`. No real vault is depicted.

This is deliberate: they stay sharp at any density, adapt to narrow screens,
weigh a few kilobytes instead of a few hundred, and cannot rot into a
screenshot of a version nobody runs any more. The trade is that they can drift
from the real UI — if you change the app's layout or palette meaningfully,
change these too. Two shared files keep the drift from happening silently:

- `../tokens.css` — the `:root` design tokens, imported by both `app/src/App.css`
  and `site/src/styles/*.css`.
- `app/src/tagColors.ts` — imported directly by the tag chips so tag hues can
  never diverge. Astro's dev server allows reading outside `site/` via
  `vite.server.fs.allow`.

The provider glyphs in `src/lib/providers.ts` are hand-drawn approximations of
each brand, paired with the vendors' real trademarked colours. Fine for mock
previews; worth replacing with vendor assets before a real launch push.

## Honesty rules for this site

The site describes what ships. It has been wrong before and the fixes were
tedious, so:

- **No feature is listed on `/features` until it is in a build.** Everything else
  goes on `/roadmap`, labelled.
- **`/download` does not offer installers that do not exist.** Until release
  signing is set up, it says so and gives build instructions.
- **`/docs/web-vs-desktop` is marked as a plan,** because the browser app is not
  built yet.
- **`/docs/privacy` must match the code.** If the Worker's logging or the app's
  request cadence changes, that page changes in the same commit.
- **Release dates are the real tag dates.** Nothing is backdated.

## Deploying

Static output, so anything that serves files works. On Cloudflare the site and
the API share the `sudonotes.com` origin:

- the site is served from `dist/` (Workers Static Assets or Pages),
- The API is a separate Worker on `api.sudonotes.com`; this build does not route it.

The two deploy independently. Nothing on this site calls the API — it is all
static — so the order does not matter.

## Search indexing after a deploy

Astro generates `sitemap-index.xml` and every public page declares its canonical
URL. After deploying a new documentation route:

1. Open the `sudonotes.com` domain property in Google Search Console.
2. Submit `https://sudonotes.com/sitemap-index.xml` if it is not already listed.
3. Inspect the homepage and the new route, then request indexing once each URL
   returns `200` in production.
4. Review impressions, clicks and average position after six to eight weeks for
   `sudonotes`, `IDEAS.md`, `IDEAS.md gitignore`, `project ideas markdown`, and
   `ideas file for coding agents`.

Do not add page analytics, `llms.txt`, or generated keyword pages to perform
this check. Search Console reports are enough for this first pass.

## Analytics

There are none, and `/docs/privacy` says so. If Cloudflare Web Analytics is ever
added it goes in `src/layouts/Base.astro`, page-level only, and that page gets
updated in the same commit. Never collect note titles, bodies, search queries,
vault paths or prompt content.

## Regenerating the OG image

`public/og.png` is rendered from `assets/og.svg`, which draws the mono wordmark
in a committed face (`assets/fonts/jetbrains-mono.woff2`) so it never falls
back to whatever font the build machine has. Render it with a headless Edge
(matches how it will look in real browsers):

```bash
"<path to msedge.exe>" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --screenshot=public/og.png --window-size=1200,630 assets/og.svg
```

On Windows, Edge ships with the OS. Adjust the path if it is elsewhere.
