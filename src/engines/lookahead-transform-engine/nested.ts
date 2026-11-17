import type { Utf8Bytes } from "../types.ts";

/**
 * Marker wrapping an `AsyncIterable` of strings and UTF-8 bytes whose chunks
 * should be **re-scanned** by a child {@link LookaheadTransformEngine}
 * sharing the parent's search strategy, concurrency strategy, and
 * replacement function.
 *
 * Returning a plain `AsyncIterable` from the replacement emits
 * its chunks verbatim; returning a `Nested` opts in to recursive
 * replacement of the nested content. Bytes are decoded as UTF-8 to be
 * searched, as one sequence for the whole source, dropping a byte order
 * mark at its start, or at the start of bytes that follow a string it yields.
 *
 * The child transformer is constructed internally when the parent's
 * drain loop reaches the slot, and its iterable slots are attached as
 * children of the parent slot in the slot tree — so tree-aware
 * comparators (`streamOrder`, `breadthFirst`) order work correctly
 * across nesting levels.
 *
 * @example
 * ```ts
 * const transformer = new LookaheadTransformEngine({
 *   searchStrategy,
 *   concurrencyStrategy,
 *   replacement: async (match) => {
 *     const { body } = await fetch(urlFrom(match));
 *     return nested(body!); // recursively re-scan the fragment
 *   }
 * });
 * ```
 */
export class Nested<T extends string | Utf8Bytes = string> {
  readonly source: AsyncIterable<T>;
  constructor(source: AsyncIterable<T>) {
    this.source = source;
  }
}

/**
 * Convenience constructor for {@link Nested}. Wraps an `AsyncIterable` of
 * strings and UTF-8 bytes to signal that it should be re-scanned by a
 * child lookahead transformer when emitted.
 */
export function nested<T extends string | Utf8Bytes>(source: AsyncIterable<T>): Nested<T> {
  return new Nested(source);
}
