/**
 * Timing run for `joinText`, which the search strategies and engines use to
 * join held text to a chunk without `+` when either side is empty.
 *
 * Both engines can pause a search at a match and resume it with
 * `processChunk("")`, `SerialTransformEngine` at every match whose replacement
 * it awaits. JavaScriptCore folds away an empty operand of `+` only when it is a
 * compile-time constant. Its FTL fast path builds a rope for a runtime `""`,
 * which the next `indexOf` resolves by copying the other side, so joining with
 * `+` costs the rest of the chunk at every resume
 * (https://bugs.webkit.org/show_bug.cgi?id=332729):
 *
 * - https://github.com/WebKit/WebKit/blob/739ed31d329cf2f0db7dc9fd41de2666aa1c4623/Source/JavaScriptCore/runtime/OperationsInlines.h#L140-L150
 * - https://github.com/WebKit/WebKit/blob/739ed31d329cf2f0db7dc9fd41de2666aa1c4623/Source/JavaScriptCore/dfg/DFGFixupPhase.cpp#L3863
 * - https://github.com/WebKit/WebKit/blob/739ed31d329cf2f0db7dc9fd41de2666aa1c4623/Source/JavaScriptCore/ftl/FTLLowerDFGToB3.cpp#L11735
 *
 * The first group times that join on its own, with `joinText` and with `+`,
 * reading the `""` from an array so that the JIT can't fold it away.
 * Once `+` is no slower on the minimum supported Bun, `joinText` can go. The
 * others time each strategy searching a 16 KiB chunk with and without pausing
 * at every match, which should cost about the same on every runtime.
 *
 * Usage (from test/benchmarks; the `pre` step compiles to build/ first):
 *   npm run bench:join-text
 *   npm run bench:join-text:bun
 */

import { bench, do_not_optimize, group, run } from "mitata";
import joinText from "../../../src/search-strategies/join-text.ts";
import { RegexSearchStrategy, StringAnchorSearchStrategy } from "../../../src/search-strategies/index.ts";
import type { MatchSink, SearchStrategy } from "../../../src/search-strategies/types.ts";

const CHUNK_LENGTH = 16 * 1024;
const chunk = "ab{{x}}".repeat(Math.ceil(CHUNK_LENGTH / 7)).slice(0, CHUNK_LENGTH);
const resumedWith = [""];

function resumeAtEveryMatch(join: (before: string, after: string) => string): number {
  let rest = chunk;
  let matches = 0;
  for (let at = rest.indexOf("}}"); at !== -1; at = rest.indexOf("}}")) {
    rest = join(rest.slice(at + 2), resumedWith[0]);
    matches++;
  }
  return matches;
}

function search<TState, TMatch>(strategy: SearchStrategy<TState, TMatch>, pauseAtEveryMatch: boolean): number {
  const state = strategy.createState();
  let paused = false;
  let matches = 0;
  const sink: MatchSink<TMatch> = {
    reportText() {},
    reportMatch() {
      matches++;
      paused = pauseAtEveryMatch;
      return !pauseAtEveryMatch;
    }
  };
  strategy.processChunk(chunk, state, sink);
  while (paused) {
    paused = false;
    strategy.processChunk("", state, sink);
  }
  return matches;
}

group("Resuming a search of a 16 KiB chunk at every match, joining the rest to a runtime \"\"", () => {
  bench("joinText", () => do_not_optimize(resumeAtEveryMatch(joinText)));
  bench("+", () => do_not_optimize(resumeAtEveryMatch((before, after) => before + after)));
});

const strategies: Record<string, SearchStrategy<unknown, unknown>> = {
  StringAnchorSearchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
  RegexSearchStrategy: new RegexSearchStrategy(/\{\{\w+\}\}/)
};

for (const [name, strategy] of Object.entries(strategies)) {
  group(`${name} searching a 16 KiB chunk`, () => {
    bench("without pausing", () => do_not_optimize(search(strategy, false)));
    bench('pausing at every match, resuming with processChunk("")', () => do_not_optimize(search(strategy, true)));
  });
}

await run();
