import type { MatchResult, SearchStrategy } from "../src/search-strategies/types.ts";
import type { StreamRegexMatch } from "../src/search-strategies/regex/types.ts";
import settleOrFlush from "../src/search-strategies/settle-or-flush.ts";

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
 * Drive `strategy` over `chunks`, collecting every yield plus what it settles at end
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
    yields: Iterable<MatchResult<TMatch>>,
    into: MatchResult<TMatch>[]
  ) => {
    for (const result of yields) {
      into.push(result);
      if (into.length > maxResults) {
        throw new Error(
          `${source} did not advance: exceeded ${maxResults} results`
        );
      }
    }
  };

  const results: MatchResult<TMatch>[] = [];
  for (const chunk of chunks) {
    collectBounded("processChunk", strategy.processChunk(chunk, state), results);
  }

  const settledResults: MatchResult<TMatch>[] = [];
  collectBounded("settle", settleOrFlush(strategy, state), settledResults);
  const settled = settledResults
    .map((result) => resultToString(strategy, result))
    .join("");
  const output =
    results.map((result) => resultToString(strategy, result)).join("") + settled;
  return { results, settled, settledResults, output };
}

function canonicalSegmentsOf<TMatch>(
  strategy: Pick<SearchStrategy<unknown, TMatch>, "matchToString">,
  results: MatchResult<TMatch>[]
): CanonicalSegment[] {
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

  for (const result of results) {
    append(result.isMatch, resultToString(strategy, result));
  }

  return segments;
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
  const segments = canonicalSegmentsOf(strategy, [
    ...results,
    ...settledResults
  ]);
  return { segments, output: segments.map(({ text }) => text).join("") };
}

/**
 * Iterate `results` into `into` until it holds `limit` results, then stop, as an
 * engine stops once `stopReplacingSignal` aborts. An engine only stops after a
 * result, so `limit` must be at least 1. Returns whether it broke out of the
 * iteration, which runs the generator's `return()` even when the limit falls on
 * its last result.
 */
function iterateUntil<TMatch>(
  results: Iterable<MatchResult<TMatch>>,
  into: MatchResult<TMatch>[],
  limit: number
): boolean {
  for (const result of results) {
    into.push(result);
    if (into.length >= limit) return true;
  }
  return false;
}

/**
 * Drive `strategy` over `chunks`, stopping after `limit` results in total, whether
 * they came from `processChunk` or `settle`. Then do what an engine does after an
 * abort: emit `flush()`, and pass the chunks not yet written through untouched.
 *
 * `output` must reproduce the input exactly, wherever iteration stopped.
 */
function collectStoppedSearchStrategyResults<TState, TMatch = string>(
  strategy: SearchStrategy<TState, TMatch>,
  chunks: string[],
  limit: number
): { stopped: boolean; output: string } {
  const state = strategy.createState();
  const reported: MatchResult<TMatch>[] = [];
  let written = 0;
  let stopped = false;
  while (!stopped && written < chunks.length) {
    stopped = iterateUntil(
      strategy.processChunk(chunks[written++], state),
      reported,
      limit
    );
  }
  if (!stopped) {
    stopped = iterateUntil(settleOrFlush(strategy, state), reported, limit);
  }
  const output =
    reported.map((result) => resultToString(strategy, result)).join("") +
    strategy.flush(state) +
    chunks.slice(written).join("");
  return { stopped, output };
}

/**
 * Drive `strategy` over `chunks`, stopping its `processChunk` result after `limit`
 * results in total, then resuming it by calling `processChunk` again with an empty
 * chunk before writing the rest.
 *
 * The `segments` must match {@link collectCanonicalSearchStrategyResults} over the
 * same chunks, wherever iteration stopped.
 */
function collectResumedSearchStrategyResults<TState, TMatch = string>(
  strategy: SearchStrategy<TState, TMatch>,
  chunks: string[],
  limit: number
): { stopped: boolean; segments: CanonicalSegment[] } {
  const state = strategy.createState();
  const results: MatchResult<TMatch>[] = [];
  let stopped = false;
  for (const chunk of chunks) {
    if (stopped) {
      results.push(...strategy.processChunk(chunk, state));
      continue;
    }
    stopped = iterateUntil(strategy.processChunk(chunk, state), results, limit);
    if (stopped) results.push(...strategy.processChunk("", state));
  }
  results.push(...settleOrFlush(strategy, state));
  return { stopped, segments: canonicalSegmentsOf(strategy, results) };
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

export type { CanonicalSegment };

export {
  collectCanonicalSearchStrategyResults,
  collectResumedSearchStrategyResults,
  collectSearchStrategyResults,
  collectStoppedSearchStrategyResults,
  regexMatchDetailsOf
};
