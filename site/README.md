# sudonotes.com

The marketing and docs site. Astro, static output, no client-side JavaScript.

```bash
cd site && npm install && npm run dev
```

```bash
cd site && npm run build
```

Output goes to `dist/`.

## The UI previews are recreations, not screenshots

`src/components/*Preview.astro` rebuild the app's interface in HTML and CSS,
using the same design tokens as `app/src/App.css`, filled with **mock data**. No
real vault is depicted.

This is deliberate: they stay sharp at any density, adapt to narrow screens,
weigh a few kilobytes instead of a few hundred, and cannot rot into a
screenshot of a version nobody runs any more. The trade is that they can drift
from the real UI — if you change the app's layout or palette meaningfully,
change these too.

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
- `sudonotes.com/api/*` routes to the Worker in `../worker`.

The two deploy independently. Nothing on this site calls the API — it is all
static — so the order does not matter.

## Analytics

There are none, and `/docs/privacy` says so. If Cloudflare Web Analytics is ever
added it goes in `src/layouts/Base.astro`, page-level only, and that page gets
updated in the same commit. Never collect note titles, bodies, search queries,
vault paths or prompt content.

## Regenerating the OG image

`public/og.png` is rendered from `assets/og.svg`:

```bash
node -e "require('sharp')('assets/og.svg',{density:144}).resize(1200,630).png().toFile('public/og.png')"
```
