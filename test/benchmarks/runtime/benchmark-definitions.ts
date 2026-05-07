import {
  SyncReplacementTransformEngine,
  AsyncSerialReplacementTransformEngine,
  type ReplacementContext
} from "../../../src/engines/index.ts";
import {
  StringAnchorSearchStrategy
} from "../../../src/search-strategies/index.ts";
import type { LoopedIndexOfAnchoredSearchState as SearchState } from "../../../src/search-strategies/looped-indexOf-anchored/search-strategy.ts";

/**
 * Core benchmark definitions - categorized object.
 * Each top-level key is a category containing an array of benchmarks.
 *
 * Search strategies are stateless and reusable across streams; they are
 * created once per definition (outside the per-iteration setup closure) so
 * benchmark measurements reflect engine + state-creation cost only.
 */

export interface BenchmarkDefinition {
  name: string;
  description: string;
  setup: () => {
    engine:
      | SyncReplacementTransformEngine<SearchState>
      | AsyncSerialReplacementTransformEngine<SearchState>;
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
      setup: (() => {
        const searchStrategy = new StringAnchorSearchStrategy(["OLD"]);
        const input = ["Hello OLD world OLD test OLD content"];
        return () => ({
          engine: new SyncReplacementTransformEngine({ searchStrategy, replacement: "NEW" }),
          input
        });
      })(),
      validate: (result: string) => {
        if (!result.includes("NEW")) {
          throw new Error("Benchmark validation failed - no replacement found");
        }
      }
    },
    {
      name: "Simple text without replacement - baseline streaming performance",
      description: "Fast path validation - no matches found",
      setup: (() => {
        const searchStrategy = new StringAnchorSearchStrategy(["NOTFOUND"]);
        const input = ["Hello world test content no matches here"];
        return () => ({
          engine: new SyncReplacementTransformEngine({ searchStrategy, replacement: "NEW" }),
          input
        });
      })(),
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
      setup: (() => {
        const searchStrategy = new StringAnchorSearchStrategy(["OLD"]);
        const input = ["OLD".repeat(10) + "content" + "OLD".repeat(10)];
        return () => ({
          engine: new SyncReplacementTransformEngine({ searchStrategy, replacement: "NEW" }),
          input
        });
      })(),
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
      setup: (() => {
        const searchStrategy = new StringAnchorSearchStrategy(["OLD"]);
        const input = ["Hello OLD world OLD test OLD content"];
        return () => ({
          engine: new SyncReplacementTransformEngine({
            searchStrategy,
            replacement: (_: string, { matchIndex }: ReplacementContext) => `NEW-${matchIndex}`
          }),
          input
        });
      })(),
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
      setup: (() => {
        const searchStrategy = new StringAnchorSearchStrategy(["BOUNDARY"]);
        const input = ["Hello BOUN", "DARY world test"];
        return () => ({
          engine: new SyncReplacementTransformEngine({ searchStrategy, replacement: "REPLACED" }),
          input
        });
      })(),
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
      setup: (() => {
        const searchStrategy = new StringAnchorSearchStrategy(["NOTFOUND"]);
        const input = ["Hello NOT", "THERE world test"];
        return () => ({
          engine: new SyncReplacementTransformEngine({ searchStrategy, replacement: "REPLACED" }),
          input
        });
      })(),
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
        const searchStrategy = new StringAnchorSearchStrategy(["NOTFOUND"]);
        const singleLong = Array.from(
          { length: 30 },
          (_, i) => `chunk ${i + 1} content no matches here`
        ).join("");
        const input = [singleLong];
        return () => ({
          engine: new SyncReplacementTransformEngine({ searchStrategy, replacement: "NEW" }),
          input
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
        const searchStrategy = new StringAnchorSearchStrategy(["OLD"]);
        const input = Array.from(
          { length: 30 },
          (_, i) => `chunk ${i + 1} content with OLD pattern here`
        );
        return () => ({
          engine: new SyncReplacementTransformEngine({ searchStrategy, replacement: "NEW" }),
          input
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
        const searchStrategy = new StringAnchorSearchStrategy(["NOTFOUND"]);
        const input = Array.from(
          { length: 30 },
          (_, i) => `chunk ${i + 1} content no matches here`
        );
        return () => ({
          engine: new SyncReplacementTransformEngine({ searchStrategy, replacement: "NEW" }),
          input
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
        const searchStrategy = new StringAnchorSearchStrategy([pattern]);
        const patternLength = pattern.length;
        const input: string[] = [];
        for (let i = 0; i < 15; i++) {
          const chunkIndex = i * 2;
          const splitPos = (i % (patternLength - 1)) + 1;
          const firstPart = pattern.substring(0, splitPos);
          const secondPart = pattern.substring(splitPos);
          input.push(`chunk ${chunkIndex + 1} content with ${firstPart}`);
          input.push(`${secondPart} and more content chunk ${chunkIndex + 2}`);
        }
        return () => ({
          engine: new SyncReplacementTransformEngine({ searchStrategy, replacement: "REPLACED" }),
          input
        });
      })(),
      validate: (result: string) => {
        if (!result.includes("REPLACED") || result.includes("BOUNDARY")) {
          throw new Error(
            "Benchmark validation failed - cross-boundary replacement incomplete"
          );
        }
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
    // First two are sync-engine baselines (run via executeBenchmark)
    {
      name: "processChunkSync with string replacement",
      description: "Sync baseline - verify no performance regression from async feature",
      setup: (() => {
        const searchStrategy = new StringAnchorSearchStrategy(["OLD"]);
        const input = ["Replace OLD and OLD and OLD content"];
        return () => ({
          engine: new SyncReplacementTransformEngine({ searchStrategy, replacement: "NEW" }),
          input
        });
      })(),
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
      setup: (() => {
        const searchStrategy = new StringAnchorSearchStrategy(["OLD"]);
        const input = ["Replace OLD and OLD and OLD content"];
        return () => ({
          engine: new SyncReplacementTransformEngine({
            searchStrategy,
            replacement: (_: string, { matchIndex }: ReplacementContext) => `NEW-${matchIndex}`
          }),
          input
        });
      })(),
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
    // Remaining six are async-engine benchmarks (run via executeBenchmarkAsync)
    {
      name: "processChunk with string replacement (async generator overhead)",
      description: "Measure overhead of async generator with string replacement",
      setup: (() => {
        const searchStrategy = new StringAnchorSearchStrategy(["OLD"]);
        const input = ["Replace OLD and OLD and OLD content"];
        return () => ({
          engine: new AsyncSerialReplacementTransformEngine({
            searchStrategy,
            replacement: async () => "NEW"
          }),
          input
        });
      })(),
      validate: (result: string) => {
        const expected = "Replace NEW and NEW and NEW content";
        if (result !== expected) {
          throw new Error("Benchmark validation failed");
        }
      }
    },
    {
      name: "processChunk with sync function (awaited)",
      description: "Measure overhead of awaiting sync function in async generator",
      setup: (() => {
        const searchStrategy = new StringAnchorSearchStrategy(["OLD"]);
        const input = ["Replace OLD and OLD and OLD content"];
        return () => ({
          engine: new AsyncSerialReplacementTransformEngine({
            searchStrategy,
            replacement: async (_: string, { matchIndex }: ReplacementContext) => `NEW-${matchIndex}`
          }),
          input
        });
      })(),
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
      setup: (() => {
        const searchStrategy = new StringAnchorSearchStrategy(["OLD"]);
        const input = ["Replace OLD and OLD and OLD content"];
        return () => ({
          engine: new AsyncSerialReplacementTransformEngine({
            searchStrategy,
            replacement: async (_: string, { matchIndex }: ReplacementContext) => {
              await Promise.resolve();
              return `NEW-${matchIndex}`;
            }
          }),
          input
        });
      })(),
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
      setup: (() => {
        const searchStrategy = new StringAnchorSearchStrategy(["OLD"]);
        const input = ["Replace OLD and OLD and OLD content"];
        return () => ({
          engine: new AsyncSerialReplacementTransformEngine({
            searchStrategy,
            replacement: (_: string, { matchIndex }: ReplacementContext) =>
              Promise.resolve(`NEW-${matchIndex}`)
          }),
          input
        });
      })(),
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
      description: "Measure streaming replacement with ReadableStream (single enqueue)",
      setup: (() => {
        const searchStrategy = new StringAnchorSearchStrategy(["OLD"]);
        const input = ["Replace OLD and OLD and OLD content"];
        return () => ({
          engine: new AsyncSerialReplacementTransformEngine({
            searchStrategy,
            replacement: async () =>
              new ReadableStream<string>({
                start(controller) {
                  controller.enqueue("NEW");
                  controller.close();
                }
              })
          }),
          input
        });
      })(),
      validate: (result: string) => {
        if (!result.includes("NEW")) {
          throw new Error("Benchmark validation failed");
        }
      }
    },
    {
      name: "processChunk with async iterable replacement (multi-chunk stream)",
      description: "Measure streaming replacement with chunked ReadableStream",
      setup: (() => {
        const searchStrategy = new StringAnchorSearchStrategy(["OLD"]);
        const input = ["Replace OLD and OLD and OLD content"];
        return () => ({
          engine: new AsyncSerialReplacementTransformEngine({
            searchStrategy,
            replacement: async (_: string, { matchIndex }: ReplacementContext) =>
              new ReadableStream<string>({
                start(controller) {
                  controller.enqueue("N");
                  controller.enqueue("E");
                  controller.enqueue("W");
                  controller.enqueue(`-${matchIndex}`);
                  controller.close();
                }
              })
          }),
          input
        });
      })(),
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

const _syncOutput: string[] = [];
const _syncSink = {
  enqueue: (chunk: string) => _syncOutput.push(chunk),
  error: (err: unknown) => { throw err; }
};

const _asyncOutput: string[] = [];
const _asyncSink = {
  enqueue: (chunk: string) => _asyncOutput.push(chunk),
  error: (err: unknown) => { throw err; }
};

export function executeBenchmark(definition: BenchmarkDefinition) {
  const { engine, input } = definition.setup();

  if (!(engine instanceof SyncReplacementTransformEngine)) {
    throw new Error(
      "executeBenchmark requires a SyncReplacementTransformEngine"
    );
  }

  _syncOutput.length = 0;
  engine.start(_syncSink);

  for (const inputChunk of input) {
    engine.write(inputChunk);
  }
  engine.end();

  const result = _syncOutput.join("");
  definition.validate(result);

  return { result, chunkCount: _syncOutput.length };
}

export async function executeBenchmarkAsync(definition: BenchmarkDefinition) {
  const { engine, input } = definition.setup();

  if (!(engine instanceof AsyncSerialReplacementTransformEngine)) {
    throw new Error(
      "executeBenchmarkAsync requires an AsyncSerialReplacementTransformEngine"
    );
  }

  _asyncOutput.length = 0;
  engine.start(_asyncSink);

  for (const inputChunk of input) {
    await engine.write(inputChunk);
  }
  engine.end();

  const result = _asyncOutput.join("");
  definition.validate(result);

  return { result, chunkCount: _asyncOutput.length };
}
