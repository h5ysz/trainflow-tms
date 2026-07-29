import { defineConfig } from "vitest/config";

// Separate from the main config on purpose.
//
// Almost everything worth testing here is pure logic that runs against a mocked Prisma
// client in milliseconds. A couple of invariants are not: `nextRefNumber` relies on how
// SQL treats NULL inside a unique index, and no mock can prove a claim about the
// database engine. Those tests need a real SQLite file, so they live here and run
// separately — which is what keeps `npm test` fast and hermetic.
//
//   npm run test:int
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/integration/**/*.test.ts"],
    // A shared SQLite file cannot take concurrent writers.
    fileParallelism: false,
    globalSetup: ["tests/integration/setup.ts"],
    testTimeout: 30_000,
  },
});
