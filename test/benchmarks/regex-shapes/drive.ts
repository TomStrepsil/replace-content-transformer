import { RegexSearchStrategy } from "../../../src/search-strategies/regex/search-strategy.ts";
import type { StringBufferState } from "../../../src/search-strategies/string-buffer-strategy-base.ts";

export interface DriveResult {
  /** Every result's content in order, matches rendered as their raw text. */
  output: string;
  /** Matches emitted by `processChunk`, i.e. settled at a chunk boundary. */
  matches: number;
  /** Matches emitted by `flush`, i.e. only settled once the stream ended. */
  flushMatches: number;
  /** Longest the buffer ever grew, in characters. */
  peakBuffer: number;
}

/**
 * Drive one strategy instance over `chunks`, recording what it emitted and how
 * much it had to hold to do so.
 *
 * `peakBuffer` is sampled after each chunk rather than continuously: the buffer
 * is only meaningful between chunks, since that is where deferral is decided.
 */
export function drive(
  strategy: RegexSearchStrategy,
  chunks: string[]
): DriveResult {
  const state: StringBufferState = strategy.createState();
  let output = "";
  let matches = 0;
  let flushMatches = 0;
  let peakBuffer = 0;

  for (const chunk of chunks) {
    for (const result of strategy.processChunk(chunk, state)) {
      if (result.isMatch) matches++;
      output += result.isMatch
        ? strategy.matchToString(result.content)
        : result.content;
    }
    if (state.buffer.length > peakBuffer) peakBuffer = state.buffer.length;
  }

  for (const result of strategy.flush(state)) {
    if (result.isMatch) flushMatches++;
    output += result.isMatch
      ? strategy.matchToString(result.content)
      : result.content;
  }

  return { output, matches, flushMatches, peakBuffer };
}

/**
 * What a non-streaming consumer produces over the whole input — the answer the
 * streamed result has to agree with, however the input was chunked.
 *
 * Zero-length matches are excluded: the strategy skips them by design, passing
 * the position through as ordinary non-match content, so counting them here
 * would report a disagreement where the documented behaviour is agreement.
 */
export function referenceMatchCount(pattern: RegExp, content: string): number {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;
  const matches = [...content.matchAll(new RegExp(pattern.source, flags))];
  return matches.filter((match) => match[0].length > 0).length;
}
