import { bench, run, group, do_not_optimize } from "mitata";
import {
  benchmarkDefinitions,
  executeBenchmark,
  executeBenchmarkAsync,
  type BenchmarkDefinition
} from "./benchmark-definitions.ts";

/**
 * Mitata Benchmark Suite - Cross-Runtime Performance Measurement
 *
 * This benchmark suite provides:
 * - Comparative performance across all scenarios
 * - Cross-runtime comparison (Bun vs Deno vs Node.js)
 *
 * Usage:
 * - Bun: bun run test/benchmarks/runtime/benchmarks.ts
 * - Deno: deno run --allow-read --allow-write --allow-env --allow-sys test/benchmarks/runtime/benchmarks.ts
 * - Node: node --experimental-strip-types test/benchmarks/runtime/benchmarks.ts
 */

const runtime = (() => {
  if (typeof globalThis !== "undefined" && "Bun" in globalThis) return "Bun";
  if (typeof globalThis !== "undefined" && "Deno" in globalThis) return "Deno";
  return "Node.js";
})();

const isJsonMode = (() => {
  if (typeof process !== "undefined" && process.argv?.includes("--json"))
    return true;
  if (typeof globalThis !== "undefined" && "Deno" in globalThis) {
    return globalThis.Deno.args?.includes("--json");
  }
  if (typeof globalThis !== "undefined" && "Bun" in globalThis) {
    return globalThis.Bun.argv?.includes("--json");
  }
  return false;
})();

if (!isJsonMode) {
  console.log(`🚀 Running benchmarks on ${runtime}`);
  console.log(
    `📊 ${
      Object.values(benchmarkDefinitions).flat().length
    } scenarios to benchmark\n`
  );
}
group("🎯 Baseline Performance", () => {
  benchmarkDefinitions.baseline.forEach((definition: BenchmarkDefinition) => {
    bench(definition.name, () => {
      executeBenchmark(definition);
    });
  });
});
group("🔗 Cross-Boundary Matching", () => {
  benchmarkDefinitions.crossBoundary.forEach(
    (definition: BenchmarkDefinition) => {
      bench(definition.name, () => {
        executeBenchmark(definition);
      });
    }
  );
});
group("📦 Multi-Chunk Streaming", () => {
  benchmarkDefinitions.multiChunk.forEach((definition: BenchmarkDefinition) => {
    bench(definition.name, () => {
      executeBenchmark(definition);
    });
  });
});
group("⚡ Scaling & Optimization", () => {
  benchmarkDefinitions.scaling.forEach((definition: BenchmarkDefinition) => {
    bench(definition.name, () => {
      executeBenchmark(definition);
    });
  });
});
group("🔄 Async Replacement Performance", () => {
  // First two benchmarks use sync execution (baseline)
  benchmarkDefinitions.async
    .slice(0, 2)
    .forEach((definition: BenchmarkDefinition) => {
      bench(definition.name, () => {
        executeBenchmark(definition);
      });
    });

  // Remaining benchmarks use async execution
  benchmarkDefinitions.async
    .slice(2)
    .forEach((definition: BenchmarkDefinition) => {
      bench(definition.name, async () => {
        await executeBenchmarkAsync(definition);
      });
    });
});

bench(`Runtime: ${runtime}`, () => {
  let sum = 0;
  for (let i = 0; i < 1000; i++) {
    sum += i;
  }
  return do_not_optimize(sum);
});

if (isJsonMode) {
  run({ format: "json" });
} else {
  run();
}
