import { RegexSearchStrategy } from "../../../src/search-strategies/regex/search-strategy.ts";
import type { StringBufferState } from "../../../src/search-strategies/string-buffer-strategy-base.ts";

export interface EmittedMatch {
  text: string;
  start: number;
  end: number;
}

export interface DriveResult {
  /** Every result's content in order, matches rendered as their raw text. */
  output: string;
  /** Matches emitted by `processChunk`, i.e. settled at a chunk boundary. */
  matches: EmittedMatch[];
  /** Matches emitted by `flush`, i.e. only settled once the stream ended. */
  flushMatches: EmittedMatch[];
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
  const matches: EmittedMatch[] = [];
  const flushMatches: EmittedMatch[] = [];
  let peakBuffer = 0;

  for (const chunk of chunks) {
    for (const result of strategy.processChunk(chunk, state)) {
      if (result.isMatch) {
        matches.push({
          text: strategy.matchToString(result.content),
          start: result.streamIndices[0],
          end: result.streamIndices[1]
        });
      }
      output += result.isMatch
        ? strategy.matchToString(result.content)
        : result.content;
    }
    if (state.buffer.length > peakBuffer) peakBuffer = state.buffer.length;
  }

  for (const result of strategy.flush(state)) {
    if (result.isMatch) {
      flushMatches.push({
        text: strategy.matchToString(result.content),
        start: result.streamIndices[0],
        end: result.streamIndices[1]
      });
    }
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
export function referenceMatches(
  pattern: RegExp,
  content: string
): EmittedMatch[] {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;
  return [...content.matchAll(new RegExp(pattern.source, flags))]
    .filter((match) => match[0].length > 0)
    .map((match) => ({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length
    }));
}

/**
 * Where the streamed matches first diverge from the non-streaming ones.
 *
 * Counting matches is not enough: a match settled too early can be *replaced*
 * rather than split — `/\d{4}-\d{2}|\d{4}/` emitting `2024` where the reference
 * has `2024-06` keeps both the count and the losslessness intact. Comparing
 * text and stream offsets in order is what catches it.
 */
export function firstDivergence(
  streamed: EmittedMatch[],
  reference: EmittedMatch[]
): { at: number; streamed?: EmittedMatch; reference?: EmittedMatch } | null {
  const length = Math.max(streamed.length, reference.length);
  for (let at = 0; at < length; at++) {
    const emitted = streamed[at];
    const expected = reference[at];
    const same =
      emitted !== undefined &&
      expected !== undefined &&
      emitted.text === expected.text &&
      emitted.start === expected.start &&
      emitted.end === expected.end;
    if (!same) return { at, streamed: emitted, reference: expected };
  }
  return null;
}
