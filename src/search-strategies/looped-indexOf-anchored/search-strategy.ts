import type { BufferGuardOptions, MatchSink, SearchStrategy } from "../types.js";
import HeldText from "../held-text.js";
import bufferGuard, { type BufferGuard } from "../buffer-guard.js";
import partialMatchLength from "./partial-match-length.js";
import validateNeedles from "./validate-needles.js";

/** Per-stream state for {@link LoopedIndexOfAnchoredSearchStrategy}, internal to it. */
export type LoopedIndexOfAnchoredSearchState = {
  /** Content received but not yet reported, and its position in the stream @internal */
  held: Readonly<HeldText>;
  /** Index of the current needle being matched in a multi-needle sequence @internal */
  currentNeedleIndex: number;
  /** Length of the held partial match already consumed by earlier anchors @internal */
  matchConsumedLength: number;
};

export const acceptMatch = Symbol("acceptMatch");

export type AcceptMatch<TState extends LoopedIndexOfAnchoredSearchState> = (
  state: TState,
  matchStart: number,
  searched: string
) => boolean;

export type AnchorOptions<
  TState extends LoopedIndexOfAnchoredSearchState = LoopedIndexOfAnchoredSearchState
> = BufferGuardOptions & { [acceptMatch]?: AcceptMatch<TState> };

/**
 * A search strategy for finding sequences of strings (anchors) that must appear
 * in order, separated by any content. For example, `['{{', 'name', '}}']`
 * matches `{{name}}` or `{{  name  }}`. A single anchor matches that string.
 *
 * Matches may span chunk boundaries. Content is only held back when the end
 * of a chunk could be the start of the first anchor, or while a match is
 * part-way through its sequence.
 *
 * A match still incomplete `maxBufferLength` code units after its first anchor
 * passes through as text up to there, and the search restarts after it. See
 * [Buffer limit](../../../docs/search-strategies.md#buffer-limit).
 *
 * Exposed publicly as `StringAnchorSearchStrategy`.
 *
 * @throws If `needles` is empty, or any needle is an empty string.
 * @throws {RangeError} If `maxBufferLength` is not a whole number of at least the
 * anchors' total length, the shortest possible match. `Infinity` is allowed;
 * `undefined` selects the default.
 */
export class LoopedIndexOfAnchoredSearchStrategy
  implements SearchStrategy<LoopedIndexOfAnchoredSearchState>
{
  private readonly needles: string[];
  private readonly guard: BufferGuard;
  private readonly acceptMatch: AcceptMatch<LoopedIndexOfAnchoredSearchState> | undefined;

  constructor(needles: string[], options?: BufferGuardOptions) {
    validateNeedles(needles);
    this.needles = [...needles];
    this.guard = bufferGuard(options, needles.join("").length);
    this.acceptMatch = (options as AnchorOptions | undefined)?.[acceptMatch];
  }

  createState(): LoopedIndexOfAnchoredSearchState {
    return { held: new HeldText(), currentNeedleIndex: 0, matchConsumedLength: 0 };
  }

  processChunk(
    haystack: string,
    state: LoopedIndexOfAnchoredSearchState,
    sink: MatchSink
  ): undefined {
    state.held.scan(haystack, sink, () => this.scan(state));
  }

  flush(state: LoopedIndexOfAnchoredSearchState): string {
    state.currentNeedleIndex = 0;
    state.matchConsumedLength = 0;
    return state.held.flush();
  }

  matchToString(match: string): string {
    return match;
  }

  private rejects(
    accept: AcceptMatch<LoopedIndexOfAnchoredSearchState>,
    state: LoopedIndexOfAnchoredSearchState,
    searchedFrom: number,
    to: number
  ): boolean {
    const { held } = state;
    return !accept(state, held.streamIndex(held.reportedTo), held.text.slice(searchedFrom, to));
  }

  private scan(state: LoopedIndexOfAnchoredSearchState): void {
    const { held } = state;
    const { text } = held;
    const length = text.length;
    let position = state.matchConsumedLength;
    state.matchConsumedLength = 0;
    for (;;) {
      const currentNeedle = this.needles[state.currentNeedleIndex];
      let index: number;
      if (state.currentNeedleIndex === 0) {
        index = text.indexOf(currentNeedle, position);
        if (index === -1) {
          held.reportText(length - partialMatchLength(text, currentNeedle, length - position));
          return;
        }
        held.reportText(index);
      } else {
        const limit = held.reportedTo + this.guard.maxBufferLength;
        const window = limit < length ? text.slice(0, limit) : text;
        index = window.indexOf(currentNeedle, position);
        if (index === -1) {
          if (length < limit) {
            state.matchConsumedLength = position - held.reportedTo;
            return;
          }
          state.currentNeedleIndex = 0;
          position = this.guard.release(text, held.reportedTo);
          held.reportText(position);
          continue;
        }
      }

      const searchedFrom = position;
      position = index + currentNeedle.length;
      state.currentNeedleIndex = (state.currentNeedleIndex + 1) % this.needles.length;
      if (state.currentNeedleIndex !== 0) continue;
      if (this.acceptMatch !== undefined && this.rejects(this.acceptMatch, state, searchedFrom, position)) {
        state.currentNeedleIndex = this.needles.length - 1;
        continue;
      }
      if (!held.reportMatch(text.slice(held.reportedTo, position), position)) return;
    }
  }
}
