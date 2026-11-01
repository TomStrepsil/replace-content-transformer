import type { BufferGuardOptions, MatchResult, SearchStrategy } from "../types.js";
import bufferGuard, { anchorsFit, passThrough, type BufferGuard } from "../buffer-guard.js";
import HeldText, { flushHeld } from "../held-text.js";
import validateNeedles from "./validate-needles.js";

/** Per-stream state for {@link LoopedIndexOfAnchoredSearchStrategy}. */
export type LoopedIndexOfAnchoredSearchState = {
  /** Content received but not yet reported. */
  held: HeldText;
  /** Stream position at or after which the next match may start. */
  candidateFrom: number;
};

/**
 * A search strategy for finding sequences of strings (anchors) that must appear
 * in order, separated by any content. For example, `['{{', 'name', '}}']`
 * matches `{{name}}` or `{{  name  }}`. A single anchor matches that string.
 *
 * Matches may span chunk boundaries. Content is only held back when the end
 * of a chunk could be the start of the first anchor, or while a match is
 * part-way through its sequence.
 *
 * A match longer than `maxBufferLength` never matches: its first anchor passes
 * through as text, and the search resumes one code unit after it. If the
 * anchors together are longer than `maxBufferLength`, nothing can match, so
 * every chunk passes straight through and `onGuardExceeded` is never called. See
 * [Buffering and the guard](../../../README.md#buffering-and-the-guard).
 *
 * Exposed publicly as `StringAnchorSearchStrategy`.
 *
 * @throws If `needles` is empty, or any needle is an empty string.
 * @throws {TypeError} If `maxBufferLength` is not a number.
 * @throws {RangeError} If `maxBufferLength` is less than 0, or `NaN`.
 */
export class LoopedIndexOfAnchoredSearchStrategy
  implements SearchStrategy<LoopedIndexOfAnchoredSearchState>
{
  private readonly needles: string[];
  private readonly guard: BufferGuard;

  constructor(needles: string[], options?: BufferGuardOptions) {
    validateNeedles(needles);
    this.needles = [...needles];
    this.guard = bufferGuard(options);
    if (!anchorsFit(this.needles, this.guard)) this.processChunk = passThrough;
  }

  createState(): LoopedIndexOfAnchoredSearchState {
    return { held: new HeldText(this.needles), candidateFrom: 0 };
  }

  *processChunk(
    haystack: string,
    state: LoopedIndexOfAnchoredSearchState
  ): Generator<MatchResult, void, undefined> {
    const { held } = state;
    held.append(haystack);
    while (true) {
      const start = held.find(0, state.candidateFrom);
      if (start === -1) {
        const text = held.takeBeforePartialAnchor(0, state.candidateFrom);
        state.candidateFrom = held.takenTo;
        if (text !== "") yield { isMatch: false, content: text };
        return;
      }

      const end = this.matchEnd(held, start);
      const heldTo = end === -1 ? held.receivedTo : end;
      if (heldTo - start > this.guard.maxBufferLength) {
        state.candidateFrom = start + 1;
        this.guard.onGuardExceeded?.({ streamIndices: [start, heldTo] });
        continue;
      }

      if (start > held.takenTo) {
        yield { isMatch: false, content: held.take(start) };
      }
      if (end === -1) return;
      state.candidateFrom = end;
      yield { isMatch: true, content: held.take(end), streamIndices: [start, end] };
    }
  }

  flush(state: LoopedIndexOfAnchoredSearchState): string {
    return flushHeld(state, this.createState());
  }

  matchToString(match: string): string {
    return match;
  }

  private matchEnd(held: HeldText, start: number): number {
    let end = start + this.needles[0].length;
    for (let index = 1; index < this.needles.length; index++) {
      const found = held.find(index, end);
      if (found === -1) return -1;
      end = found + this.needles[index].length;
    }
    return end;
  }
}
