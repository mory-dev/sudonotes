import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Stand-ins for the production secrets; nothing real is needed because
        // both DeepSeek and Turnstile are intercepted in the tests.
        bindings: {
          DEEPSEEK_API_KEY: "test-key",
          TURNSTILE_SECRET: "test-turnstile",
          DEVICE_TOKEN_SECRET: "test-device-secret",
        },
      },
    }),
  ],
});
