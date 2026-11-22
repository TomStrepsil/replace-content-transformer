import { describe, it, expect } from "vitest";
import joinText from "./join-text.ts";
import { RegexSearchStrategy, StringAnchorSearchStrategy } from "./index.ts";
import type { MatchSink, SearchStrategy } from "./types.ts";

// JavaScriptCore (WebKit 739ed31d329cf2f0db7dc9fd41de2666aa1c4623) folds away an empty operand of `+`
// only when it is a compile-time constant; its FTL fast path builds a rope for a runtime "", which the
// next indexOf resolves by copying the other side:
// https://github.com/WebKit/WebKit/blob/739ed31d329cf2f0db7dc9fd41de2666aa1c4623/Source/JavaScriptCore/runtime/OperationsInlines.h#L140-L150
// https://github.com/WebKit/WebKit/blob/739ed31d329cf2f0db7dc9fd41de2666aa1c4623/Source/JavaScriptCore/dfg/DFGFixupPhase.cpp#L3863
// https://github.com/WebKit/WebKit/blob/739ed31d329cf2f0db7dc9fd41de2666aa1c4623/Source/JavaScriptCore/ftl/FTLLowerDFGToB3.cpp#L11735
// Reported as https://bugs.webkit.org/show_bug.cgi?id=332729. Once the minimum supported Bun includes its fix,
// joinText() and this file can go, and the strategies can join with `+` again.

const CHUNK_LENGTH = 16 * 1024;
const WARM_UP_RUNS = 30;
const TIMED_RUNS = 15;
const MAX_PAUSE_COST_RATIO = 5;

const notBunsJavaScriptCore = !("Bun" in globalThis);

function median(times: number[]): number {
  return times.toSorted((a, b) => a - b)[times.length >> 1];
}

const chunk = "ab{{x}}".repeat(Math.ceil(CHUNK_LENGTH / 7)).slice(0, CHUNK_LENGTH);

function timeSearch<TState, TMatch>(strategy: SearchStrategy<TState, TMatch>, pauseAtEveryMatch: boolean): number {
  const state = strategy.createState();
  let paused = false;
  const sink: MatchSink<TMatch> = {
    reportText() {},
    reportMatch() {
      paused = pauseAtEveryMatch;
      return !pauseAtEveryMatch;
    }
  };
  const start = performance.now();
  strategy.processChunk(chunk, state, sink);
  while (paused) {
    paused = false;
    strategy.processChunk("", state, sink);
  }
  return performance.now() - start;
}

function searchTimer<TState, TMatch>(strategy: SearchStrategy<TState, TMatch>) {
  return (pauseAtEveryMatch: boolean) => timeSearch(strategy, pauseAtEveryMatch);
}

describe("joinText, which joins without `+` when one side is empty, because JavaScriptCore's optimising JIT turns a runtime empty operand into a rope that the next search copies", () => {
  it("returns the text before when the text after is empty", () => {
    expect(joinText("held", "")).toBe("held");
  });

  it("returns the text after when the text before is empty", () => {
    expect(joinText("", "chunk")).toBe("chunk");
  });

  it("joins two texts that aren't empty", () => {
    expect(joinText("held", "chunk")).toBe("heldchunk");
  });

  it.skipIf(notBunsJavaScriptCore).each([
    { name: "StringAnchorSearchStrategy", timer: () => searchTimer(new StringAnchorSearchStrategy(["{{", "}}"])) },
    { name: "RegexSearchStrategy", timer: () => searchTimer(new RegexSearchStrategy(/\{\{\w+\}\}/)) }
  ])(
    `lets $name search a 16 KiB chunk pausing at every match, resuming with processChunk(""), at under ${MAX_PAUSE_COST_RATIO}x the time of searching it without pausing (on Bun only, whose JavaScriptCore copies the held text otherwise)`,
    ({ timer }) => {
      const timeSearchOfChunk = timer();
      for (let run = 0; run < WARM_UP_RUNS; run++) {
        timeSearchOfChunk(true);
        timeSearchOfChunk(false);
      }
      const paused: number[] = [];
      const unpaused: number[] = [];
      for (let run = 0; run < TIMED_RUNS; run++) {
        paused.push(timeSearchOfChunk(true));
        unpaused.push(timeSearchOfChunk(false));
      }

      expect(median(paused) / median(unpaused)).toBeLessThan(MAX_PAUSE_COST_RATIO);
    }
  );
});
