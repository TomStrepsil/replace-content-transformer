import type {
  BufferGuardOptions,
  MatchSink,
  SearchStrategy,
  StreamIndices
} from "../src/search-strategies/types.ts";
import type { StreamRegexMatch } from "../src/search-strategies/regex/types.ts";
import settleOrFlush from "../src/search-strategies/settle-or-flush.ts";

/** One result reported to a sink: literal text, or a match with its stream indices. */
type MatchResult<TMatch = string> =
  | { isMatch: false; content: string }
  | { isMatch: true; content: TMatch; streamIndices: StreamIndices };

type CanonicalSegment = { isMatch: boolean; text: string };

function resultToString<TMatch>(
  strategy: Pick<SearchStrategy<unknown, TMatch>, "matchToString">,
  result: MatchResult<TMatch>
): string {
  return result.isMatch
    ? strategy.matchToString(result.content)
    : result.content;
}

/**
 * A sink that records every result into `into`, calling `afterEach` after each one.
 * A match continues the scan when `afterEach` returns `true`.
 */
function sinkInto<TMatch>(
  into: MatchResult<TMatch>[],
  afterEach: () => boolean = () => true
): MatchSink<TMatch> {
  return {
    reportText(content) {
      into.push({ isMatch: false, content });
      afterEach();
    },
    reportMatch(content, streamIndices) {
      into.push({ isMatch: true, content, streamIndices });
      return afterEach();
    }
  };
}

/** Every result `strategy.processChunk` reports for `haystack`. */
function processChunkResults<TState, TMatch>(
  strategy: SearchStrategy<TState, TMatch>,
  haystack: string,
  state: TState
): MatchResult<TMatch>[] {
  const results: MatchResult<TMatch>[] = [];
  strategy.processChunk(haystack, state, sinkInto(results));
  return results;
}

/** Every result `strategy.settle` reports. */
function settleResults<TState, TMatch>(
  strategy: SearchStrategy<TState, TMatch>,
  state: TState
): MatchResult<TMatch>[] {
  const results: MatchResult<TMatch>[] = [];
  strategy.settle!(state, sinkInto(results));
  return results;
}

/**
 * Drive `strategy` over `chunks`, collecting every result plus what it settles at end
 * of stream (its `settle`, or its `flush` as one non-match when it has no `settle`).
 *
 * `output` concatenates everything the strategy reported, matches rendered as their
 * raw text, so it must always reproduce the input exactly.
 *
 * Kept free of any test-runner import so non-test tooling (e.g. the chunk-variance
 * diagnostic) can reuse it.
 *
 * Both `processChunk` and `settle` scan until their cursor passes the end, so both
 * are bounded by `maxResults`: a scan that stops advancing fails the test rather
 * than exhausting the heap and killing the worker.
 */
function collectSearchStrategyResults<TState, TMatch = string>(
  strategy: SearchStrategy<TState, TMatch>,
  chunks: string[],
  maxResults = 10_000
): {
  results: MatchResult<TMatch>[];
  settled: string;
  settledResults: MatchResult<TMatch>[];
  output: string;
} {
  const state = strategy.createState();

  const collectBounded = (
    source: string,
    scan: (sink: MatchSink<TMatch>) => void,
    into: MatchResult<TMatch>[]
  ) =>
    scan(
      sinkInto(into, () => {
        if (into.length > maxResults) {
          throw new Error(
            `${source} did not advance: exceeded ${maxResults} results`
          );
        }
        return true;
      })
    );

  const results: MatchResult<TMatch>[] = [];
  for (const chunk of chunks) {
    collectBounded(
      "processChunk",
      (sink) => strategy.processChunk(chunk, state, sink),
      results
    );
  }

  const settledResults: MatchResult<TMatch>[] = [];
  collectBounded(
    "settle",
    (sink) => settleOrFlush(strategy, state, sink),
    settledResults
  );
  const settled = settledResults
    .map((result) => resultToString(strategy, result))
    .join("");
  const output =
    results.map((result) => resultToString(strategy, result)).join("") + settled;
  return { results, settled, settledResults, output };
}

/**
 * As {@link collectSearchStrategyResults}, but reduced to a chunking-independent
 * form: adjacent non-match yields (and what is settled at end of stream) are merged into a
 * single segment, and matches are reduced to their raw text.
 *
 * Two runs over the same input split differently should produce identical
 * segments — where the *fragmentation* of non-match content legitimately varies
 * with chunking, the match sequence must not.
 *
 * `output` is the concatenation of every segment, which must always reproduce
 * the input exactly (the lossless invariant), regardless of pattern or split.
 */
function collectCanonicalSearchStrategyResults<TState, TMatch = string>(
  strategy: SearchStrategy<TState, TMatch>,
  chunks: string[]
): { segments: CanonicalSegment[]; output: string } {
  const { results, settledResults } = collectSearchStrategyResults(
    strategy,
    chunks
  );
  const segments: CanonicalSegment[] = [];

  function append(isMatch: boolean, text: string): void {
    if (!isMatch) {
      if (text === "") return;
      const last = segments.at(-1);
      if (last && !last.isMatch) {
        last.text += text;
        return;
      }
    }
    segments.push({ isMatch, text });
  }

  for (const result of [...results, ...settledResults]) {
    append(result.isMatch, resultToString(strategy, result));
  }

  return { segments, output: segments.map(({ text }) => text).join("") };
}

/**
 * Drive `strategy` over `chunks`, stopping at the `limit`th match, whether it came from
 * `processChunk` or `settle`. Then do what an engine does after an abort: emit `flush()`,
 * and pass the chunks not yet written through untouched.
 *
 * `output` must reproduce the input exactly, wherever the scan stopped.
 */
function collectStoppedSearchStrategyResults<TState, TMatch = string>(
  strategy: SearchStrategy<TState, TMatch>,
  chunks: string[],
  limit: number
): { stopped: boolean; output: string } {
  const state = strategy.createState();
  const reported: MatchResult<TMatch>[] = [];
  let matches = 0;
  const sink: MatchSink<TMatch> = {
    reportText: (content) => {
      reported.push({ isMatch: false, content });
    },
    reportMatch: (content, streamIndices) => {
      reported.push({ isMatch: true, content, streamIndices });
      return ++matches < limit;
    }
  };
  let written = 0;
  while (matches < limit && written < chunks.length) {
    strategy.processChunk(chunks[written++], state, sink);
  }
  if (matches < limit) settleOrFlush(strategy, state, sink);
  const output =
    reported.map((result) => resultToString(strategy, result)).join("") +
    strategy.flush(state) +
    chunks.slice(written).join("");
  return { stopped: matches === limit, output };
}

/**
 * Drive `strategy` over `chunks` as the async engines do: stop at every match, then carry
 * on with `processChunk("")`, or with `settle` again at end of stream, until nothing is
 * left. The results must equal an uninterrupted run's.
 */
function collectPausedSearchStrategyResults<TState, TMatch = string>(
  strategy: SearchStrategy<TState, TMatch>,
  chunks: string[]
): MatchResult<TMatch>[] {
  const state = strategy.createState();
  const reported: MatchResult<TMatch>[] = [];
  let paused = false;
  const sink: MatchSink<TMatch> = {
    reportText: (content) => {
      reported.push({ isMatch: false, content });
    },
    reportMatch: (content, streamIndices) => {
      reported.push({ isMatch: true, content, streamIndices });
      paused = true;
      return false;
    }
  };
  for (const chunk of chunks) {
    strategy.processChunk(chunk, state, sink);
    while (paused) {
      paused = false;
      strategy.processChunk("", state, sink);
    }
  }
  do {
    paused = false;
    settleOrFlush(strategy, state, sink);
  } while (paused);
  return reported;
}

/**
 * Drive `strategy` over `chunks`, returning the most code units received but not
 * yet reported, after any chunk, and whether anything was reported before the
 * last chunk.
 */
function heldWhileDriving<TState, TMatch = string>(
  strategy: SearchStrategy<TState, TMatch>,
  chunks: string[]
): { longestHeld: number; reportedBeforeLastChunk: boolean } {
  const state = strategy.createState();
  let unreported = 0;
  let longestHeld = 0;
  let reportedBeforeLastChunk = false;
  chunks.forEach((chunk, index) => {
    unreported += chunk.length;
    for (const result of processChunkResults(strategy, chunk, state)) {
      unreported -= resultToString(strategy, result).length;
      reportedBeforeLastChunk ||= index < chunks.length - 1;
    }
    longestHeld = Math.max(longestHeld, unreported);
  });
  strategy.flush(state);
  return { longestHeld, reportedBeforeLastChunk };
}

type GuardedStrategy<TState, TMatch> = (
  options: BufferGuardOptions
) => SearchStrategy<TState, TMatch>;

const asText = (text: string): CanonicalSegment => ({ isMatch: false, text });
const asMatch = (text: string): CanonicalSegment => ({ isMatch: true, text });

/**
 * Drive the strategy from `create` over `chunks` with an `onGuardExceeded` that
 * throws, then `flush` it, as an engine does once processing fails. `output` is
 * what was reported, then what was flushed, then the chunks never processed.
 */
function outputWhenGuardThrows<TState, TMatch>(
  create: GuardedStrategy<TState, TMatch>,
  chunks: string[],
  maxBufferLength: number
): { threw: boolean; output: string } {
  const strategy = create({
    maxBufferLength,
    onGuardExceeded: () => {
      throw new Error("onGuardExceeded failed");
    }
  });
  const state = strategy.createState();
  let output = "";
  for (const [index, chunk] of chunks.entries()) {
    try {
      strategy.processChunk(chunk, state, {
        reportText: (content) => {
          output += content;
        },
        reportMatch: (content) => {
          output += strategy.matchToString(content);
          return true;
        }
      });
    } catch {
      return {
        threw: true,
        output: output + strategy.flush(state) + chunks.slice(index + 1).join("")
      };
    }
  }
  return { threw: false, output: output + strategy.flush(state) };
}

/**
 * Reduce the matches from {@link collectSearchStrategyResults} over a regex
 * strategy to plain data, so runs over different splits or strategies can be
 * compared with `toEqual`.
 */
function regexMatchDetailsOf({
  results,
  settledResults
}: {
  results: MatchResult<StreamRegexMatch>[];
  settledResults: MatchResult<StreamRegexMatch>[];
}) {
  return [...results, ...settledResults]
    .filter((result) => result.isMatch)
    .map(({ content, streamIndices }) => ({
      captures: [...content],
      index: content.index,
      groups: content.groups,
      indices: content.indices && [...content.indices],
      indexGroups: content.indices?.groups,
      streamIndices
    }));
}

export type { CanonicalSegment, GuardedStrategy, MatchResult };

export {
  asMatch,
  asText,
  collectCanonicalSearchStrategyResults,
  collectPausedSearchStrategyResults,
  collectSearchStrategyResults,
  collectStoppedSearchStrategyResults,
  heldWhileDriving,
  outputWhenGuardThrows,
  processChunkResults,
  regexMatchDetailsOf,
  settleResults,
  sinkInto
};
