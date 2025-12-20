import { defineConfig } from "vitest/config";
import env from "./test/vitest.env.js";

const isCI = env.isCI();

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    globals: true,
    reporters: isCI ? ["default", "github-actions", "junit"] : ["default"],
    outputFile: isCI ? { junit: "./test-results/junit.xml" } : undefined,
    coverage: {
      include: ["src/**/*.ts", "benchmarks/**/*.ts"],
      exclude: ["**/index.ts", "**/*.d.ts", "**/*.bench.ts"]
    }
  },
  setupFiles: ["./test/vitest.setup.js"]
});
