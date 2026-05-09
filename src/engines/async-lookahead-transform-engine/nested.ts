/**
 * Marker wrapping an `AsyncIterable<string>` whose chunks should be
 * **re-scanned** by a child {@link AsyncLookaheadTransformEngine}
 * sharing the parent's search strategy, concurrency strategy, and
 * replacement function.
 *
 * Returning a plain `AsyncIterable<string>` from the replacement emits
 * its chunks verbatim; returning a `Nested` opts in to recursive
 * replacement of the nested content.
 *
 * The child transformer is constructed internally when the parent's
 * drain loop reaches the slot, and its iterable slots are attached as
 * children of the parent slot in the slot tree — so tree-aware
 * comparators (`streamOrder`, `breadthFirst`) order work correctly
 * across nesting levels.
 *
 * @example
 * ```ts
 * const transformer = new AsyncLookaheadTransformEngine({
 *   searchStrategy,
 *   concurrencyStrategy,
 *   replacement: async (match) => {
 *     const body = await fetchFragment(match);
 *     return nested(body); // recursively re-scan the fragment
 *   }
 * });
 * ```
 */
export class Nested {
  readonly source: AsyncIterable<string>;
  constructor(source: AsyncIterable<string>) {
    this.source = source;
  }
}

/**
 * Convenience constructor for {@link Nested}. Wraps an
 * `AsyncIterable<string>` to signal that it should be re-scanned by a
 * child lookahead transformer when emitted.
 */
export function nested(source: AsyncIterable<string>): Nested {
  return new Nested(source);
}
