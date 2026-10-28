import validateNeedles from "../looped-indexOf-anchored/validate-needles.js";
import bufferGuard, { type BufferGuard } from "../buffer-guard.js";
import HeldText from "../held-text.js";
import type {
  BufferGuardOptions,
  MatchResult,
  SearchStrategy,
  StreamIndices
} from "../types.js";

const OPENING = 0;
const CLOSING = 1;
const AWAITING_CLOSING = -1;

/** Per-stream state for {@link BalancedPairSearchStrategy}. */
export type BalancedPairSearchState = {
  /** Content received but not yet reported. */
  held: HeldText;
  /** Stream position at or after which the next opening delimiter may start. */
  openingFrom: number;
  /** Stream position at or after which the next closing delimiter may start. */
  closingFrom: number;
  /**
   * From index `outermost`, in stream order: each opening delimiter awaiting its
   * closing delimiter (`[start, -1]`), and each pair completed inside them.
   */
  pairs: StreamIndices[];
  outermost: number;
};

/**
 * A search strategy for matching balanced delimiter pairs, including nested
 * occurrences. A match completes only when every opening delimiter inside it
 * has a corresponding closing delimiter, so `(` and `)` match the whole of
 * `((a) b)` rather than stopping at the first `)`.
 *
 * Matches may span chunk boundaries. Unbalanced content is emitted verbatim
 * at end of stream. The match content is the matched string, delimiters
 * included.
 *
 * A pair longer than `maxBufferLength` never matches: its opening delimiter
 * passes through as text, and the pairs nested inside it are matched as if it
 * were absent. See [Buffering and the guard](../../../README.md#buffering-and-the-guard).
 *
 * See [README](./README.md) for the algorithm.
 *
 * @throws If `opening` or `closing` is an empty string.
 * @throws {TypeError} If `maxBufferLength` is not a number.
 * @throws {RangeError} If `maxBufferLength` is less than 0, or `NaN`.
 *
 * @example
 * ```typescript
 * import { BalancedPairSearchStrategy, SyncReplacementTransformEngine } from 'replace-content-transformer';
 *
 * const engine = new SyncReplacementTransformEngine({
 *   searchStrategy: new BalancedPairSearchStrategy('{{', '}}'),
 *   replacement: (match) => match.toUpperCase()
 * });
 * ```
 */
export class BalancedPairSearchStrategy implements SearchStrategy<
  BalancedPairSearchState,
  string
> {
  private readonly delimiters: [opening: string, closing: string];
  private readonly guard: BufferGuard;

  /**
   * @param opening - String that opens a pair. Each occurrence inside a match increases the nesting level.
   * @param closing - String that closes a pair. The match ends at the closing string that returns the nesting level to zero.
   */
  constructor(opening: string, closing: string, options?: BufferGuardOptions) {
    validateNeedles([opening, closing]);
    this.delimiters = [opening, closing];
    this.guard = bufferGuard(options);
  }

  createState(): BalancedPairSearchState {
    return {
      held: new HeldText(this.delimiters),
      openingFrom: 0,
      closingFrom: 0,
      pairs: [],
      outermost: 0
    };
  }

  *processChunk(
    haystack: string,
    state: BalancedPairSearchState
  ): Generator<MatchResult, void, undefined> {
    const { held, pairs } = state;
    const [{ length: openingLength }, { length: closingLength }] = this.delimiters;
    held.append(haystack);
    for (;;) {
      if (
        state.outermost < pairs.length &&
        pairs[state.outermost][1] !== AWAITING_CLOSING
      ) {
        const pair = pairs[state.outermost++];
        if (pair[0] > held.start) {
          yield { isMatch: false, content: held.take(pair[0]) };
        }
        yield { isMatch: true, content: held.take(pair[1]), streamIndices: pair };
        continue;
      }

      if (state.outermost === pairs.length) {
        const opening = held.find(OPENING, state.openingFrom);
        if (opening === -1) {
          state.openingFrom = held.partialAnchorStart(OPENING, state.openingFrom);
          if (state.openingFrom > held.start) {
            yield { isMatch: false, content: held.take(state.openingFrom) };
          }
          return;
        }
        pairs.length = state.outermost = 0;
        pairs.push([opening, AWAITING_CLOSING]);
        state.openingFrom = state.closingFrom = opening + openingLength;
      }

      const closing = held.find(CLOSING, state.closingFrom);
      const opening = held.find(OPENING, state.openingFrom);
      const opens =
        opening !== -1 &&
        (closing === -1 || opening + openingLength <= closing + closingLength);
      const tokenEnd = opens
        ? opening + openingLength
        : closing === -1
          ? held.end
          : closing + closingLength;
      const [outermostStart] = pairs[state.outermost];

      if (tokenEnd - outermostStart > this.guard.maxBufferLength) {
        this.abandonOutermost(state);
      } else if (opens) {
        pairs.push([opening, AWAITING_CLOSING]);
        state.openingFrom = tokenEnd;
      } else if (closing === -1) {
        if (outermostStart > held.start) {
          yield { isMatch: false, content: held.take(outermostStart) };
        }
        return;
      } else {
        state.openingFrom = state.closingFrom = tokenEnd;
        let [start, end] = pairs.pop()!;
        while (end !== AWAITING_CLOSING) [start, end] = pairs.pop()!;
        const pair: StreamIndices = [start, tokenEnd];
        if (state.outermost < pairs.length) {
          pairs.push(pair);
          continue;
        }
        if (start > held.start) {
          yield { isMatch: false, content: held.take(start) };
        }
        yield { isMatch: true, content: held.take(tokenEnd), streamIndices: pair };
      }
    }
  }

  flush(state: BalancedPairSearchState): string {
    const flushed = state.held.take(state.held.end);
    Object.assign(state, this.createState());
    return flushed;
  }

  matchToString(match: string): string {
    return match;
  }

  private abandonOutermost(state: BalancedPairSearchState): void {
    const { held, pairs } = state;
    const [start] = pairs[state.outermost++];
    if (state.outermost * 2 >= pairs.length) {
      pairs.splice(0, state.outermost);
      state.outermost = 0;
    }
    this.guard.onGuardExceeded?.({ streamIndices: [start, held.end] });
  }
}
