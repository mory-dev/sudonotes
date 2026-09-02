import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    pool: "threads",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
