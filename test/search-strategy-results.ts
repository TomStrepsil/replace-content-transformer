import type { MatchResult, SearchStrategy } from "../src/search-strategies/types.ts";

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
 * Drain a strategy's {@link SearchStrategy.flush} into a single string.
 *
 * For assertions that only care about the text a strategy is still holding,
 * rather than the results it settles that buffer into.
 */
function flushToString<TState, TMatch>(
  strategy: Pick<SearchStrategy<TState, TMatch>, "flush" | "matchToString">,
  state: TState
): string {
  let flushed = "";
  for (const result of strategy.flush(state)) {
    flushed += resultToString(strategy, result);
  }
  return flushed;
}

/**
 * Drive `strategy` over `chunks`, collecting every yield plus the final `flush()`.
 *
 * `output` concatenates everything the strategy reported, matches rendered as their
 * raw text, so it must always reproduce the input exactly.
 *
 * Kept free of any test-runner import so non-test tooling (e.g. the chunk-variance
 * diagnostic) can reuse it.
 */
function collectSearchStrategyResults<TState, TMatch = string>(
  strategy: SearchStrategy<TState, TMatch>,
  chunks: string[],
  maxResults = 10_000
): {
  results: MatchResult<TMatch>[];
  flush: string;
  flushResults: MatchResult<TMatch>[];
  output: string;
} {
  const state = strategy.createState();
  const results: MatchResult<TMatch>[] = [];
  for (const chunk of chunks) {
    for (const result of strategy.processChunk(chunk, state)) {
      results.push(result);
      if (results.length > maxResults) {
        throw new Error(
          `processChunk did not advance: exceeded ${maxResults} results`
        );
      }
    }
  }
  const flushResults = [...strategy.flush(state)];
  const flush = flushResults
    .map((result) => resultToString(strategy, result))
    .join("");
  const output =
    results.map((result) => resultToString(strategy, result)).join("") + flush;
  return { results, flush, flushResults, output };
}

/**
 * As {@link collectSearchStrategyResults}, but reduced to a chunking-independent
 * form: adjacent non-match yields (and the trailing `flush()`) are merged into a
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
  const { results, flushResults } = collectSearchStrategyResults(
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

  for (const result of [...results, ...flushResults]) {
    append(result.isMatch, resultToString(strategy, result));
  }

  return { segments, output: segments.map(({ text }) => text).join("") };
}

export type { CanonicalSegment };

export {
  collectCanonicalSearchStrategyResults,
  collectSearchStrategyResults,
  flushToString
};
