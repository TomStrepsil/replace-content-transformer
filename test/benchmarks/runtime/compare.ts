#!/usr/bin/env -S node --experimental-strip-types

/**
 * Cross-Runtime Benchmark Comparison Tool
 *
 * Runs benchmarks on all available runtimes and generates a comparison table
 */

import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";

interface BenchmarkResult {
  name: string;
  runtime: string;
  hz: number;
  avgNs: number;
  category: string;
}

interface RuntimeInfo {
  name: string;
  command: string;
  args: string[];
  available: boolean;
}

const RUNTIMES: RuntimeInfo[] = [
  {
    name: "Bun",
    command: "bun",
    args: [
      "run",
      "./test/benchmarks/runtime-comparison/benchmarks.ts",
      "--json"
    ],
    available: false
  },
  {
    name: "Deno",
    command: "deno",
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-sys",
      "./test/benchmarks/runtime-comparison/benchmarks.ts",
      "--json"
    ],
    available: false
  },
  {
    name: "Node",
    command: "node",
    args: [
      "--experimental-strip-types",
      "./test/benchmarks/runtime-comparison/benchmarks.ts",
      "--json"
    ],
    available: false
  }
];

// Check which runtimes are available
async function checkRuntimeAvailability(): Promise<RuntimeInfo[]> {
  const availableRuntimes: RuntimeInfo[] = [];

  for (const runtime of RUNTIMES) {
    try {
      const result = await new Promise((resolve) => {
        const proc = spawn(runtime.command, ["--version"], { stdio: "pipe" });
        proc.on("close", (code) => resolve(code === 0));
        proc.on("error", () => resolve(false));
      });

      if (result) {
        runtime.available = true;
        availableRuntimes.push(runtime);
      }
    } catch {
      // Runtime not available
    }
  }

  return availableRuntimes;
}

// Parse Mitata JSON output to extract benchmark results
function parseMitataJsonOutput(
  output: string,
  runtime: string
): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];

  try {
    const jsonData = JSON.parse(output);

    // Mitata JSON format has benchmarks in a 'benchmarks' array
    if (jsonData.benchmarks && Array.isArray(jsonData.benchmarks)) {
      for (const benchmark of jsonData.benchmarks) {
        // Get the name from either 'alias' or 'name' field
        const name = benchmark.alias || benchmark.name;

        // Skip runtime baseline benchmarks in comparison
        if (name && name.includes("Runtime:")) continue;

        // Skip if name is empty
        if (!name) continue;

        // Determine category from benchmark name
        let category = "Other";
        if (name.includes("Simple") || name.includes("baseline")) {
          category = "Baseline";
        } else if (
          name.includes("Cross-boundary") ||
          name.includes("boundary")
        ) {
          category = "Cross-Boundary";
        } else if (
          name.includes("Multi-chunk") ||
          name.includes("multiple chunks")
        ) {
          category = "Multi-Chunk";
        } else if (name.includes("scaling") || name.includes("KMP")) {
          category = "Scaling";
        }

        // Extract performance metrics from the runs array
        if (benchmark.runs && benchmark.runs.length > 0) {
          const run = benchmark.runs[0]; // Take the first run
          const stats = run.stats;

          if (stats && stats.avg) {
            const avgTimeNs = stats.avg; // Already in nanoseconds
            const hz = avgTimeNs > 0 ? 1_000_000_000 / avgTimeNs : 0;

            results.push({
              name: name,
              runtime: runtime,
              hz: hz,
              avgNs: avgTimeNs,
              category: category
            });
          }
        }
      }
    }
  } catch (error) {
    console.error(
      `Failed to parse JSON output for ${runtime}:`,
      (error as Error).message
    );
    console.error("Raw output:", output.substring(0, 500));
  }

  return results;
}

// Run benchmark for a specific runtime
async function runBenchmarkForRuntime(
  runtime: RuntimeInfo
): Promise<BenchmarkResult[]> {
  return new Promise((resolve) => {
    console.log(`📊 Running benchmarks for ${runtime.name}...`);

    const proc = spawn(runtime.command, runtime.args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd()
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        const results = parseMitataJsonOutput(stdout, runtime.name);
        console.log(
          `✅ ${runtime.name} completed (${results.length} benchmarks)`
        );
        resolve(results);
      } else {
        console.error(`❌ ${runtime.name} failed with code ${code}`);
        console.error(`Error: ${stderr}`);
        resolve([]); // Return empty results instead of rejecting
      }
    });

    proc.on("error", (error) => {
      console.error(`❌ Failed to start ${runtime.name}: ${error.message}`);
      resolve([]); // Return empty results instead of rejecting
    });
  });
}

// Generate comparison table
function generateComparisonTable(allResults: BenchmarkResult[]): string {
  // Group results by benchmark name
  const benchmarkGroups = new Map<string, BenchmarkResult[]>();

  for (const result of allResults) {
    if (!benchmarkGroups.has(result.name)) {
      benchmarkGroups.set(result.name, []);
    }
    benchmarkGroups.get(result.name)!.push(result);
  }

  // Generate table
  const runtimes = Array.from(new Set(allResults.map((r) => r.runtime))).sort();
  let table = "\n📊 CROSS-RUNTIME BENCHMARK COMPARISON\n";
  table += "=".repeat(86) + "\n\n";

  // Header
  table += "Benchmark".padEnd(50);
  for (const runtime of runtimes) {
    table += runtime.padStart(12);
  }

  // Group by category
  const categories = ["Baseline", "Cross-Boundary", "Multi-Chunk", "Scaling"];

  for (const category of categories) {
    const categoryBenchmarks = Array.from(benchmarkGroups.entries()).filter(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ([_, results]) => results.some((r) => r.category === category)
    );

    if (categoryBenchmarks.length === 0) continue;

    table += `\n${category} Performance:\n`;

    for (const [benchmarkName, results] of categoryBenchmarks) {
      let shortName = benchmarkName;
      if (shortName.length > 48) {
        shortName = shortName.substring(0, 45) + "...";
      }

      table += shortName.padEnd(50);

      // Find best performance
      const maxHz = Math.max(...results.map((r) => r.hz));

      for (const runtime of runtimes) {
        const result = results.find((r) => r.runtime === runtime);
        if (result) {
          let value = "";
          if (result.hz > 1_000_000) {
            value = `${(result.hz / 1_000_000).toFixed(1)}M Hz`;
          } else if (result.hz > 1_000) {
            value = `${(result.hz / 1_000).toFixed(0)}K Hz`;
          } else {
            value = `${result.hz.toFixed(0)} Hz`;
          }

          if (result.hz === maxHz) {
            value = `🏆 ${value}`;
          }
          table += value.padStart(12);
        } else {
          table += "N/A".padStart(12);
        }
      }

      table += `\n`;
    }
  }

  return table;
}

// Main function
async function main() {
  console.log("🎯 Cross-Runtime Benchmark Comparison");
  console.log("======================================\n");

  const availableRuntimes = await checkRuntimeAvailability();

  if (availableRuntimes.length === 0) {
    console.error("❌ No supported runtimes found (bun, deno, node)");
    process.exit(1);
  }

  console.log(
    `🚀 Found runtimes: ${availableRuntimes.map((r) => r.name).join(", ")}\n`
  );

  const allResults: BenchmarkResult[] = [];

  // Run benchmarks for each runtime
  for (const runtime of availableRuntimes) {
    const results = await runBenchmarkForRuntime(runtime);
    allResults.push(...results);
    console.log(); // Add spacing between runs
  }

  if (allResults.length === 0) {
    console.error("❌ No benchmark results collected");
    process.exit(1);
  }

  // Generate and display comparison table
  const comparisonTable = generateComparisonTable(allResults);
  console.log(comparisonTable);

  // Save results as JSON
  const jsonResults = {
    timestamp: new Date().toISOString(),
    runtimes: availableRuntimes.map((r) => r.name),
    results: allResults
  };

  await fs.writeFile(
    path.join(process.cwd(), "benchmark-results.json"),
    JSON.stringify(jsonResults, null, 2)
  );

  console.log("\n💾 Results saved to benchmark-results.json");
  console.log("\n💡 Tips for interpretation:");
  console.log("   - 🏆 indicates the fastest runtime for each benchmark");
  console.log("   - Higher Hz = better performance");
  console.log("   - M = million, K = thousand operations per second");
  console.log("   - Compare within categories for meaningful insights");
}

main().catch(console.error);
