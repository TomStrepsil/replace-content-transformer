/**
 * Timing run for `partialMatchLength`, the check `StringAnchorSearchStrategy`
 * makes at the end of each chunk for a partial first anchor.
 *
 * The shipped check finds where the anchor's first character appears in the
 * last `anchor.length - 1` characters (the window) in one of two ways: it reads
 * a short window one character at a time, and calls `indexOf` on a longer one.
 * Each way is measured here on its own at every window size, so the window size
 * where `indexOf` starts to pay is visible, and the shipped check should keep
 * pace with whichever is faster at each size. Each check is driven by its own
 * loop, so no call site sees more than one of them.
 *
 * Usage (from test/benchmarks; the `pre` step compiles to build/ first):
 *   npm run bench:partial-match-length
 */

import { bench, do_not_optimize, group, run } from "mitata";
import partialMatchLength from "../../../src/search-strategies/looped-indexOf-anchored/partial-match-length.ts";
import { chunksOf } from "../../splits.ts";

type Check = (haystack: string, needle: string, unreportedLength: number) => number;

function matchesToEnd(haystack: string, needle: string, start: number): boolean {
  const length = haystack.length;
  let at = start + 1;
  while (at < length && haystack.charCodeAt(at) === needle.charCodeAt(at - start)) at++;
  return at === length;
}

const scanOnly: Check = (haystack, needle, unreportedLength) => {
  const length = haystack.length;
  const firstCode = needle.charCodeAt(0);
  for (let start = length - Math.min(needle.length - 1, unreportedLength); start < length; start++) {
    if (haystack.charCodeAt(start) === firstCode && matchesToEnd(haystack, needle, start)) {
      return length - start;
    }
  }
  return 0;
};

const indexOfOnly: Check = (haystack, needle, unreportedLength) => {
  const length = haystack.length;
  const firstCharacter = needle[0];
  for (
    let start = haystack.indexOf(firstCharacter, length - Math.min(needle.length - 1, unreportedLength));
    start !== -1;
    start = haystack.indexOf(firstCharacter, start + 1)
  ) {
    if (matchesToEnd(haystack, needle, start)) return length - start;
  }
  return 0;
};

const markup = '<div class="item"><a href="/page">Link</a> <span>Some text</span></div>\n'.repeat(64);
const haystacks = [...chunksOf(markup, 61), ...chunksOf(markup, 64)];
const anchor = "<esi:include";
const windows = [1, 2, 3, 4, 5, 6, 11];

const totalsOver: Record<string, (needle: string) => number> = {
  shipped(needle) {
    let total = 0;
    for (const haystack of haystacks) total += partialMatchLength(haystack, needle, Infinity);
    return total;
  },
  "scan only"(needle) {
    let total = 0;
    for (const haystack of haystacks) total += scanOnly(haystack, needle, Infinity);
    return total;
  },
  "indexOf only"(needle) {
    let total = 0;
    for (const haystack of haystacks) total += indexOfOnly(haystack, needle, Infinity);
    return total;
  }
};

for (const window of windows) {
  const needle = anchor.slice(0, window + 1);
  const totals = new Set(Object.values(totalsOver).map((totalOver) => totalOver(needle)));
  if (totals.size !== 1) {
    throw new Error(`The references disagree with partialMatchLength for "${needle}"`);
  }

  group(`Window of ${window} ("${needle}", ${haystacks.length} chunk ends)`, () => {
    for (const [name, totalOver] of Object.entries(totalsOver)) {
      bench(name, () => do_not_optimize(totalOver(needle)));
    }
  });
}

await run();
