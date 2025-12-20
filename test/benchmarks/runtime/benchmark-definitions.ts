import {
  StaticReplacementProcessor,
  FunctionReplacementProcessor,
  AsyncFunctionReplacementProcessor,
  AsyncIterableFunctionReplacementProcessor
} from "../../../src/replacement-processors/index.ts";
import {
  StringAnchorSearchStrategy,
  type StringAnchorSearchState as SearchState
} from "../../../src/search-strategies/index.ts";

/**
 * Core benchmark definitions - categorized object
 * Each top-level key is a category containing an array of benchmarks.
 */

export interface BenchmarkDefinition {
  name: string;
  description: string;
  setup: () => {
    processor:
      | StaticReplacementProcessor<SearchState>
      | FunctionReplacementProcessor
      | AsyncFunctionReplacementProcessor<SearchState>
      | AsyncIterableFunctionReplacementProcessor<SearchState>;
    input: string[];
  };
  validate: (result: string) => void;
}

export const benchmarkDefinitions: {
  baseline: BenchmarkDefinition[];
  crossBoundary: BenchmarkDefinition[];
  multiChunk: BenchmarkDefinition[];
  scaling: BenchmarkDefinition[];
  async: BenchmarkDefinition[];
} = {
  baseline: [
    {
      name: "Simple string replacement - baseline streaming performance",
      description:
        "Single pattern replacement in single chunk - foundational performance",
      setup: () => ({
        processor: new StaticReplacementProcessor({
          searchStrategy: new StringAnchorSearchStrategy(["OLD"]),
          replacement: "NEW"
        }),
        input: ["Hello OLD world OLD test OLD content"]
      }),
      validate: (result: string) => {
        if (!result.includes("NEW")) {
          throw new Error("Benchmark validation failed - no replacement found");
        }
      }
    },
    {
      name: "Simple text without replacement - baseline streaming performance",
      description: "Fast path validation - no matches found",
      setup: () => ({
        processor: new StaticReplacementProcessor({
          searchStrategy: new StringAnchorSearchStrategy([
            "NOTFOUND"
          ]),
          replacement: "NEW"
        }),
        input: ["Hello world test content no matches here"]
      }),
      validate: (result: string) => {
        const expected = "Hello world test content no matches here";
        if (result !== expected) {
          throw new Error("Benchmark validation failed - content changed");
        }
      }
    },
    {
      name: "Multiple replacements single chunk - baseline streaming performance",
      description: "Scaling performance with multiple matches",
      setup: () => ({
        processor: new StaticReplacementProcessor({
          searchStrategy: new StringAnchorSearchStrategy(["OLD"]),
          replacement: "NEW"
        }),
        input: ["OLD".repeat(10) + "content" + "OLD".repeat(10)]
      }),
      validate: (result: string) => {
        if (!result.includes("NEW") || result.includes("OLD")) {
          throw new Error(
            "Benchmark validation failed - replacement incomplete"
          );
        }
      }
    },
    {
      name: "Function-based replacement - baseline streaming performance",
      description:
        "Function replacement with match indexing - new feature performance baseline",
      setup: () => ({
        processor: new FunctionReplacementProcessor({
          searchStrategy: new StringAnchorSearchStrategy(["OLD"]),
          replacement: (matchedContent: string, index: number) => `NEW-${index}`
        }),
        input: ["Hello OLD world OLD test OLD content"]
      }),
      validate: (result: string) => {
        if (
          !result.includes("NEW-0") ||
          !result.includes("NEW-1") ||
          !result.includes("NEW-2")
        ) {
          throw new Error(
            "Benchmark validation failed - function replacement incomplete"
          );
        }
      }
    }
  ],
  crossBoundary: [
    {
      name: "Cross-boundary pattern matching - buffering overhead measurement",
      description: "Multi-chunk scenario with pattern spanning boundaries",
      setup: () => ({
        processor: new StaticReplacementProcessor({
          searchStrategy: new StringAnchorSearchStrategy([
            "BOUNDARY"
          ]),
          replacement: "REPLACED"
        }),
        input: ["Hello BOUN", "DARY world test"]
      }),
      validate: (result: string) => {
        if (!result.includes("REPLACED")) {
          throw new Error(
            "Benchmark validation failed - cross-boundary match not found"
          );
        }
      }
    },
    {
      name: "Cross-boundary no match - partial match buffer overhead",
      description:
        "Multi-chunk scenario with partial matches requiring buffering",
      setup: () => ({
        processor: new StaticReplacementProcessor({
          searchStrategy: new StringAnchorSearchStrategy([
            "NOTFOUND"
          ]),
          replacement: "REPLACED"
        }),
        input: ["Hello NOT", "THERE world test"]
      }),
      validate: (result: string) => {
        const expected = "Hello NOTTHERE world test";
        if (result !== expected) {
          throw new Error(
            "Benchmark validation failed - content should be unchanged"
          );
        }
      }
    }
  ],
  multiChunk: [
    {
      name: "Single long no-match - same length as multi-chunk",
      description:
        "Single large chunk with no matches whose total length equals the 30-chunk test (for like-for-like comparison)",
      setup: (() => {
        const precomputedInput = Array.from(
          { length: 30 },
          (_, i) => `chunk ${i + 1} content no matches here`
        );

        const singleLong = precomputedInput.join("");

        return () => ({
          processor: new StaticReplacementProcessor({
            searchStrategy: new StringAnchorSearchStrategy([
              "NOTFOUND"
            ]),
            replacement: "NEW"
          }),
          input: [singleLong]
        });
      })(),
      validate: (result: string) => {
        if (result.includes("NEW")) {
          throw new Error(
            "Benchmark validation failed - unexpected replacement found"
          );
        }
      }
    },
    {
      name: "Multiple replacements across multiple chunks - streaming scaling performance",
      description:
        "30 chunks each containing one match to test streaming replacement scaling",
      setup: (() => {
        const precomputedInput = Array.from(
          { length: 30 },
          (_, i) => `chunk ${i + 1} content with OLD pattern here`
        );

        return () => ({
          processor: new StaticReplacementProcessor({
            searchStrategy: new StringAnchorSearchStrategy(["OLD"]),
            replacement: "NEW"
          }),
          input: precomputedInput
        });
      })(),
      validate: (result: string) => {
        if (!result.includes("NEW") || result.includes("OLD")) {
          throw new Error(
            "Benchmark validation failed - replacement incomplete across chunks"
          );
        }
        const newCount = (result.match(/NEW/g) || []).length;
        if (newCount !== 30) {
          throw new Error(
            `Benchmark validation failed - expected 30 replacements, got ${newCount}`
          );
        }
      }
    },
    {
      name: "Multi-chunk simple content - chunk processing overhead isolation",
      description:
        "30 chunks with no matches to isolate pure chunk processing cost",
      setup: (() => {
        const precomputedInput = Array.from(
          { length: 30 },
          (_, i) => `chunk ${i + 1} content no matches here`
        );

        return () => ({
          processor: new StaticReplacementProcessor({
            searchStrategy: new StringAnchorSearchStrategy([
              "NOTFOUND"
            ]),
            replacement: "NEW"
          }),
          input: precomputedInput
        });
      })(),
      validate: (result: string) => {
        if (result.includes("NEW")) {
          throw new Error(
            "Benchmark validation failed - unexpected replacement found"
          );
        }
      }
    }
  ],
  scaling: [
    {
      name: "Multi-chunk cross-boundary KMP scaling - distributed partial matches",
      description:
        "30 chunks with cross-boundary patterns at varying split positions to test KMP table utilization",
      setup: (() => {
        const pattern = "BOUNDARY";
        const patternLength = pattern.length;
        const precomputedInput: string[] = [];

        // Create 15 cross-boundary matches across 30 chunks (every other pair)
        for (let i = 0; i < 15; i++) {
          const chunkIndex = i * 2;
          // Vary split position: cycle through different positions in the pattern
          const splitPos = (i % (patternLength - 1)) + 1; // 1 to 7

          const firstPart = pattern.substring(0, splitPos);
          const secondPart = pattern.substring(splitPos);

          precomputedInput.push(
            `chunk ${chunkIndex + 1} content with ${firstPart}`
          );
          precomputedInput.push(
            `${secondPart} and more content chunk ${chunkIndex + 2}`
          );
        }

        return () => ({
          processor: new StaticReplacementProcessor({
            searchStrategy: new StringAnchorSearchStrategy([
              pattern
            ]),
            replacement: "REPLACED"
          }),
          input: precomputedInput
        });
      })(),
      validate: (result: string) => {
        if (!result.includes("REPLACED") || result.includes("BOUNDARY")) {
          throw new Error(
            "Benchmark validation failed - cross-boundary replacement incomplete"
          );
        }
        // Should have exactly 15 replacements
        const replacementCount = (result.match(/REPLACED/g) || []).length;
        if (replacementCount !== 15) {
          throw new Error(
            `Benchmark validation failed - expected 15 replacements, got ${replacementCount}`
          );
        }
      }
    }
  ],
  async: [
    {
      name: "processChunkSync with string replacement",
      description:
        "Sync baseline - verify no performance regression from async feature",
      setup: () => ({
        processor: new StaticReplacementProcessor({
          searchStrategy: new StringAnchorSearchStrategy(["OLD"]),
          replacement: "NEW"
        }),
        input: ["Replace OLD and OLD and OLD content"]
      }),
      validate: (result: string) => {
        const expected = "Replace NEW and NEW and NEW content";
        if (result !== expected) {
          throw new Error("Benchmark validation failed");
        }
      }
    },
    {
      name: "processChunkSync with sync function replacement",
      description: "Sync function baseline - verify function call overhead",
      setup: () => ({
        processor: new FunctionReplacementProcessor({
          searchStrategy: new StringAnchorSearchStrategy(["OLD"]),
          replacement: (content, index) => `NEW-${index}`
        }),
        input: ["Replace OLD and OLD and OLD content"]
      }),
      validate: (result: string) => {
        if (
          !result.includes("NEW-0") ||
          !result.includes("NEW-1") ||
          !result.includes("NEW-2")
        ) {
          throw new Error("Benchmark validation failed");
        }
      }
    },
    {
      name: "processChunk with string replacement (async generator overhead)",
      description:
        "Measure overhead of async generator with string replacement",
      setup: () => ({
        processor: new AsyncFunctionReplacementProcessor({
          searchStrategy: new StringAnchorSearchStrategy(["OLD"]),
          replacement: async () => "NEW"
        }),
        input: ["Replace OLD and OLD and OLD content"]
      }),
      validate: (result: string) => {
        const expected = "Replace NEW and NEW and NEW content";
        if (result !== expected) {
          throw new Error("Benchmark validation failed");
        }
      }
    },
    {
      name: "processChunk with sync function (awaited)",
      description:
        "Measure overhead of awaiting sync function in async generator",
      setup: () => ({
        processor: new AsyncFunctionReplacementProcessor({
          searchStrategy: new StringAnchorSearchStrategy(["OLD"]),
          replacement: async (content, index) => `NEW-${index}`
        }),
        input: ["Replace OLD and OLD and OLD content"]
      }),
      validate: (result: string) => {
        if (
          !result.includes("NEW-0") ||
          !result.includes("NEW-1") ||
          !result.includes("NEW-2")
        ) {
          throw new Error("Benchmark validation failed");
        }
      }
    },
    {
      name: "processChunk with async function (Promise.resolve)",
      description: "Measure true async replacement with Promise.resolve",
      setup: () => ({
        processor: new AsyncFunctionReplacementProcessor({
          searchStrategy: new StringAnchorSearchStrategy(["OLD"]),
          replacement: async (content, index) => {
            await Promise.resolve();
            return `NEW-${index}`;
          }
        }),
        input: ["Replace OLD and OLD and OLD content"]
      }),
      validate: (result: string) => {
        if (
          !result.includes("NEW-0") ||
          !result.includes("NEW-1") ||
          !result.includes("NEW-2")
        ) {
          throw new Error("Benchmark validation failed");
        }
      }
    },
    {
      name: "processChunk with async function (immediate microtask)",
      description: "Measure async replacement returning immediate Promise",
      setup: () => ({
        processor: new AsyncFunctionReplacementProcessor({
          searchStrategy: new StringAnchorSearchStrategy(["OLD"]),
          replacement: async (content, index) => {
            return Promise.resolve(`NEW-${index}`);
          }
        }),
        input: ["Replace OLD and OLD and OLD content"]
      }),
      validate: (result: string) => {
        if (
          !result.includes("NEW-0") ||
          !result.includes("NEW-1") ||
          !result.includes("NEW-2")
        ) {
          throw new Error("Benchmark validation failed");
        }
      }
    },
    {
      name: "processChunk with async iterable replacement (single stream)",
      description: "Measure streaming replacement with ReadableStream",
      setup: () => ({
        processor: new AsyncIterableFunctionReplacementProcessor({
          searchStrategy: new StringAnchorSearchStrategy(["OLD"]),
          replacement: async () => {
            return new ReadableStream({
              start(controller) {
                controller.enqueue("NEW");
                controller.close();
              }
            });
          }
        }),
        input: ["Replace OLD and OLD and OLD content"]
      }),
      validate: (result: string) => {
        if (!result.includes("NEW")) {
          throw new Error("Benchmark validation failed");
        }
      }
    },
    {
      name: "processChunk with async iterable replacement (multi-chunk stream)",
      description: "Measure streaming replacement with chunked ReadableStream",
      setup: () => ({
        processor: new AsyncIterableFunctionReplacementProcessor({
          searchStrategy: new StringAnchorSearchStrategy(["OLD"]),
          replacement: async (content, index) => {
            return new ReadableStream({
              start(controller) {
                controller.enqueue("N");
                controller.enqueue("E");
                controller.enqueue("W");
                controller.enqueue(`-${index}`);
                controller.close();
              }
            });
          }
        }),
        input: ["Replace OLD and OLD and OLD content"]
      }),
      validate: (result: string) => {
        if (
          !result.includes("NEW-0") ||
          !result.includes("NEW-1") ||
          !result.includes("NEW-2")
        ) {
          throw new Error("Benchmark validation failed");
        }
      }
    }
  ]
};

export function executeBenchmark(definition: BenchmarkDefinition) {
  const { processor, input } = definition.setup();

  if (
    !(processor instanceof StaticReplacementProcessor) &&
    !(processor instanceof FunctionReplacementProcessor)
  ) {
    throw new Error(
      "executeBenchmark requires StaticReplacementProcessor or FunctionReplacementProcessor"
    );
  }

  const outputChunks: string[] = [];

  for (const inputChunk of input) {
    for (const chunk of processor.processChunk(inputChunk)) {
      outputChunks.push(chunk);
    }
  }

  const flushResult = processor.flush();
  if (flushResult) {
    outputChunks.push(flushResult);
  }

  const result = outputChunks.join("");
  definition.validate(result);

  return { result, chunkCount: outputChunks.length };
}

export async function executeBenchmarkAsync(definition: BenchmarkDefinition) {
  const { processor, input } = definition.setup();

  if (
    !(processor instanceof AsyncFunctionReplacementProcessor) &&
    !(processor instanceof AsyncIterableFunctionReplacementProcessor)
  ) {
    throw new Error(
      "executeBenchmarkAsync requires AsyncFunctionReplacementProcessor or AsyncIterableFunctionReplacementProcessor"
    );
  }

  const outputChunks: string[] = [];

  for (const inputChunk of input) {
    for await (const chunk of processor.processChunk(inputChunk)) {
      outputChunks.push(chunk);
    }
  }

  const flushResult = processor.flush();
  if (flushResult) {
    outputChunks.push(flushResult);
  }

  const result = outputChunks.join("");
  definition.validate(result);

  return { result, chunkCount: outputChunks.length };
}
