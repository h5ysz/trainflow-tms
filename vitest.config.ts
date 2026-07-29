import { defineConfig } from "vitest/config";

// The units under test (grading, permissions, cron, ref numbers) are plain TypeScript
// libraries: no JSX, no DOM, no Next compiler. Keeping the environment to "node" and
// omitting the React plugin is what makes `npm test` fast enough to run on every change.
//
// Anything that needs a real database lives in vitest.integration.config.ts instead.
export default defineConfig({
  resolve: {
    // Picks up the `@/*` mapping from tsconfig.json, so there is no second alias table
    // to drift out of sync.
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["tests/integration/**", "node_modules/**", ".next/**"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**"],
      exclude: ["src/lib/**/*.test.ts"],
    },
  },
});
