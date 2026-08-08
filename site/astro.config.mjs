// @ts-check
import sitemap from "@astrojs/sitemap";
import { defineConfig, fontProviders } from "astro/config";

export default defineConfig({
  site: "https://sudonotes.com",
  integrations: [sitemap()],
  // Everything here is static; there is no server on this side of the origin.
  // `/api/*` is a separate Worker and is not routed by this build.
  output: "static",
  build: { inlineStylesheets: "auto" },
  vite: {
    server: {
      // The previews import app/src/tagColors.ts, which lives outside the site
      // root, so the dev server must be allowed to read it.
      fs: { allow: [".."] },
    },
  },
  experimental: {
    fonts: [
      {
        provider: fontProviders.google(),
        name: "Inter",
        cssVariable: "--font-ui",
        weights: ["100 900"],
        styles: ["normal"],
        subsets: ["latin"],
        display: "swap",
        fallbacks: ["Segoe UI", "system-ui", "sans-serif"],
        optimizedFallbacks: true,
      },
      {
        provider: fontProviders.google(),
        name: "JetBrains Mono",
        cssVariable: "--font-mono",
        weights: ["100 800"],
        styles: ["normal"],
        subsets: ["latin"],
        display: "swap",
        fallbacks: ["Cascadia Mono", "Consolas", "monospace"],
        optimizedFallbacks: true,
      },
    ],
  },
});
