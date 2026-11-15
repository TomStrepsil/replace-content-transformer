/**
 * Timing run for `partialMatchLength`, the check `StringAnchorSearchStrategy`
 * makes at the end of each chunk for a partial first anchor.
 *
 * The check looks for the anchor's first character in the last
 * `anchor.length - 1` characters (the window). There are two ways to find it:
 * reading each character of the window, or calling `indexOf`. Each way is
 * measured here on its own at every window size, next to the shipped check, so
 * the window size where `indexOf` starts to pay is visible on each runtime. The
 * shipped check reads a one-character window and calls `indexOf` on a longer
 * one, as reading only pays at that size on every runtime measured.
 *
 * Each window size runs in a process of its own, as a check that has run one
 * of its branches for earlier sizes is slower on JavaScriptCore when it
 * switches to the other. Each check is driven by its own loop, so no call site
 * sees more than one of them. Chunks come from a `TextDecoder`, as the
 * adapters' do: V8 reads a sliced string more slowly than a flat one.
 *
 * Usage (from test/benchmarks; the `pre` step compiles to build/ first):
 *   npm run bench:partial-match-length
 *   npm run bench:partial-match-length:bun
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bench, do_not_optimize, group, run } from "mitata";
import partialMatchLength from "../../../src/search-strategies/looped-indexOf-anchored/partial-match-length.ts";

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

function decodedChunksOf(bytes: Uint8Array, size: number): string[] {
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length; start += size) {
    chunks.push(decoder.decode(bytes.subarray(start, start + size), { stream: true }));
  }
  return chunks;
}

const markup = new TextEncoder().encode(
  '<div class="item"><a href="/page">Link</a> <span>Some text</span></div>\n'.repeat(64)
);
const haystacks = [...decodedChunksOf(markup, 61), ...decodedChunksOf(markup, 64)];
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

const windowFlag = process.argv.indexOf("--window");

if (windowFlag === -1) {
  for (const window of windows) {
    const { status } = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), "--window", String(window)],
      { stdio: "inherit" }
    );
    if (status !== 0) process.exit(status ?? 1);
  }
} else {
  const window = Number(process.argv[windowFlag + 1]);
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

  await run();
}
