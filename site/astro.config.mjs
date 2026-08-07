// @ts-check
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://sudonotes.com",
  integrations: [sitemap()],
  // Everything here is static; there is no server on this side of the origin.
  // `/api/*` is a separate Worker and is not routed by this build.
  output: "static",
  build: { inlineStylesheets: "auto" },
});
