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
 * - `settles` — the match completes before the end of the chunk, so it is
 *   emitted at once. A match that happens to end exactly on the chunk edge is
 *   held like any other (see `defers`).
 * - `defers` — the candidate reaches the end of the haystack, so more input
 *   could change it and it is held until the next chunk (or `flush`) resolves
 *   it. On a backreference or lookahead pattern a candidate that ends earlier
 *   defers too when `hitEnd()` says the partial regex read to the end, since
 *   what a lookahead inspects reaches past the matched text. Buffering is
 *   bounded by the length of the pending match.
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
const boundaryChunkSize = 64;
const boundaryTerminator = "END";
const boundaryAligned = repeat(
  "lorem ipsum dolor sit amet ".repeat(3).slice(
    0,
    boundaryChunkSize - boundaryTerminator.length
  ) + boundaryTerminator,
  24
);
const declarations = repeat(
  "border-top: 1px; border-bottom: 2px; padding-top: 3px; border-top: 4px; ",
  20
);

export const shapes: ContentShape[] = [
  {
    name: "terminator — /\\{\\{[^{}]*\\}\\}/ over a template",
    description:
      "The closing anchor cannot be consumed by the body, so a match settles the moment it completes, unless it ends exactly on a chunk edge. The shape the algorithm suite already covers, kept here as the baseline the others are read against.",
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
      "The lower-priority branch can complete while the higher-priority one is still viable, which leaves the partial match reaching the end of the haystack, so it defers.",
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
    name: "astral characters — /(?<char>.)/u over emoji",
    description:
      "One match per code point under the `u` flag, over content mixing astral characters with ASCII. Chunk edges fall between whole characters, as a `TextDecoder` delivers them: a chunk that splits a surrogate pair is unsupported input.",
    boundary: "defers",
    pattern: /(?<char>.)/u,
    content: emoji,
    chunkSize: 27
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
    name: "lookahead — /border(?=-top)/ over stylesheet declarations",
    description:
      "The matched text stops four characters short of what the assertion inspects, so a candidate that ends well inside the chunk still cannot settle until the lookahead's content has arrived. Every candidate costs a second, anchored `exec` against the original pattern, and one in three is ruled out by it.",
    boundary: "defers",
    pattern: /border(?=-top)/,
    content: declarations,
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
      "One match per character: maximum yield rate, minimum scan work per match. Isolates per-match overhead from scanning overhead. The digit that lands on a chunk edge defers to the next chunk.",
    boundary: "defers",
    pattern: /\d/,
    content: digits,
    chunkSize: 64
  },
  {
    name: "boundary-aligned — /END/ over matches ending on chunk edges",
    description:
      "Every chunk ends with a complete, exact-length match that nothing can extend. A match reaching the end of the haystack is always held until the next chunk, because `flush` can settle it with the original pattern, so every one of these defers and is emitted with the following chunk. Isolates the cost of that deferral.",
    boundary: "defers",
    pattern: /END/,
    content: boundaryAligned,
    chunkSize: boundaryChunkSize
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
