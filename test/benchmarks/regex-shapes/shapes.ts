/**
 * Content shapes for the regex search strategy, chosen by what each one forces
 * the scan to do at a chunk boundary.
 *
 * The algorithm suite next door measures anchor-shaped content exclusively
 * (`{{`/`}}`), which is the one shape whose match can always settle the moment
 * it completes: the terminator cannot be consumed by the body. That leaves the
 * deferral codepaths — the ones that make the strategy chunk-invariant, and the
 * ones that cost buffering — unmeasured. These shapes cover them.
 */

/**
 * What the scan has to do when a match candidate reaches the end of a chunk.
 *
 * - `settles` — the match completes and cannot grow, so it is emitted at once.
 * - `defers` — the partial reaches end-of-haystack, so the match is held until
 *   the next chunk (or `flush`) resolves it. Buffering is bounded by the length
 *   of the pending match.
 * - `buffers-to-end` — nothing can ever stop the match growing, so the buffer
 *   runs to the end of the stream. This is the worst case the deferral buys.
 * - `no-match` — nothing viable anywhere; the cheapest path, one partial `exec`
 *   per scan position and no buffering at all.
 */
export type BoundaryBehaviour =
  | "settles"
  | "defers"
  | "buffers-to-end"
  | "no-match";

export interface ContentShape {
  name: string;
  description: string;
  boundary: BoundaryBehaviour;
  pattern: RegExp;
  content: string;
  chunkSize: number;
}

const repeat = (unit: string, times: number) => unit.repeat(times);

const prose = repeat(
  "The quick brown fox jumps over the lazy dog while MEASURING THINGS carefully. ",
  20
);
const template = repeat(
  "<p>Hello {{name}}, welcome to {{place}} on {{date}}.</p> filler text here. ",
  20
);
const csv = repeat(
  "2024-06-01,2024-07-15,2023-12-31,plain text, more text here. ",
  20
);
const unbroken = repeat("abcdefghij", 150);
const emoji = repeat("ok 😄 fine 🎉 done 🚀 next ", 40);
const attributes = repeat(
  'key=value flag=on mode=strict name=alice depth=3 label=none ',
  20
);
const duplicated = repeat("alpha alpha beta gamma gamma delta epsilon ", 20);
const digits = repeat("8675309", 200);

export const shapes: ContentShape[] = [
  {
    name: "terminator — /\\{\\{[^{}]*\\}\\}/ over a template",
    description:
      "The closing anchor cannot be consumed by the body, so every match settles the moment it completes. The shape the algorithm suite already covers, kept here as the baseline the others are read against.",
    boundary: "settles",
    pattern: /\{\{[^{}]*\}\}/,
    content: template,
    chunkSize: 64
  },
  {
    name: "eager class — /[A-Z]+/ over prose",
    description:
      "A run of capitals landing on a chunk edge could always be longer, so it defers. Buffering is bounded by the length of the run.",
    boundary: "defers",
    pattern: /[A-Z]+/,
    content: prose,
    chunkSize: 64
  },
  {
    name: "alternation — /\\d{4}-\\d{2}-\\d{2}|\\d{4}/ over dates",
    description:
      "The lower-priority branch can complete while the higher-priority one is still viable, so a match that ends well short of the chunk edge still has to defer.",
    boundary: "defers",
    pattern: /\d{4}-\d{2}-\d{2}|\d{4}/,
    content: csv,
    chunkSize: 64
  },
  {
    name: "named groups with indices — /(?<key>\\w+)=(?<value>\\w+)/d",
    description:
      "Exercises the `d`-flag index rebasing applied to every settled match, on content dense enough that it happens per chunk.",
    boundary: "defers",
    pattern: /(?<key>\w+)=(?<value>\w+)/d,
    content: attributes,
    chunkSize: 64
  },
  {
    name: "surrogate pairs — /(?<char>.)/u over emoji",
    description:
      "Chunk edges fall inside surrogate pairs. A lone high surrogate is a viable partial, so it defers and rejoins its low surrogate rather than matching alone.",
    boundary: "defers",
    pattern: /(?<char>.)/u,
    content: emoji,
    chunkSize: 25
  },
  {
    name: "backreference — /(\\w+) \\1/ over repeated words",
    description:
      "A genuine backreference cannot use the cheap static partial regex: the partial `exec` re-expands the captured value atom by atom. The most expensive scan the strategy supports.",
    boundary: "defers",
    pattern: /(\w+) \1/,
    content: duplicated,
    chunkSize: 64
  },
  {
    name: "nullable — /\\d*/ over prose",
    description:
      "Matches the empty string everywhere, so almost every scan position takes the zero-length skip path, which advances the cursor by one code unit instead of deferring.",
    boundary: "settles",
    pattern: /\d*/,
    content: prose,
    chunkSize: 64
  },
  {
    name: "dense — /\\d/ over digits",
    description:
      "One match per character: maximum yield rate, minimum scan work per match. Isolates per-match overhead from scanning overhead.",
    boundary: "settles",
    pattern: /\d/,
    content: digits,
    chunkSize: 64
  },
  {
    name: "no terminator — /\\S+/ over unbroken text",
    description:
      "Nothing can stop the match growing, so the buffer runs to the end of the stream and the whole buffer is re-scanned on every chunk. The worst case for the deferral, and the shape whose cost grows with stream length rather than as a constant factor.",
    boundary: "buffers-to-end",
    pattern: /\S+/,
    content: unbroken,
    chunkSize: 64
  },
  {
    name: "no match — /ZZZ\\d+/ over prose",
    description:
      "Nothing viable at any position. One partial `exec` per scan position and no buffering — the path that got cheaper, since the redundant second scan is gone.",
    boundary: "no-match",
    pattern: /ZZZ\d+/,
    content: prose,
    chunkSize: 64
  }
];

/**
 * Stream lengths for the growth curve on a shape that never settles.
 *
 * A single ratio against a baseline is misleading for `buffers-to-end` content:
 * the buffer is re-scanned from position 0 on every chunk, so the cost rises
 * with the length of the stream. Sampling several lengths shows the shape of
 * that curve rather than one point on it.
 */
export const scalingSizes = [1500, 3000, 6000, 12000, 24000] as const;

export function unbrokenContent(size: number): string {
  return repeat("abcdefghij", Math.ceil(size / 10)).slice(0, size);
}

export function chunksOf(content: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += size) {
    chunks.push(content.slice(index, index + size));
  }
  return chunks;
}
