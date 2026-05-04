import {
  LookaheadEngine,
  type LookaheadAsyncIterableTransformerOptions,
} from "../../lookahead/engine.ts";

export type {
  LookaheadAsyncIterableTransformerOptions,
  ReplacementFn
} from "../../lookahead/engine.ts";

/**
 * A WHATWG {@link Transformer} that scans streaming input for matches
 * and replaces each one with the chunks of an `AsyncIterable<string>`
 * produced by an async replacement function.
 *
 * Unlike the simpler `AsyncIterableFunctionReplacementProcessor`, this
 * transformer eagerly **initiates** replacement work as matches are
 * discovered — rather than serially awaiting each replacement before
 * looking for the next match. Downstream output order is preserved:
 * earlier matches' chunks are flushed before later matches' chunks,
 * even if the later match's iterable is ready first.
 *
 * Concurrency and prioritisation of the initiations is delegated to the
 * injected {@link ConcurrencyStrategy}.
 *
 * ### Recursive re-scanning
 *
 * Return a `Nested` (via the `nested()` helper) from the replacement to
 * opt in to re-scanning the replacement's output with a child engine
 * that inherits the parent's configuration. The child's iterable slots
 * are attached as descendants of the parent's slot in the slot tree, so
 * tree-aware comparators (`streamOrder`, `breadthFirst`) order work
 * correctly across nesting levels. The concurrency strategy is shared —
 * nested work competes for the same budget.
 *
 * This class is a thin adapter over {@link LookaheadEngine}; see the
 * engine for the push/scan/drain internals.
 *
 * @typeParam TState - The search strategy's state type
 * @typeParam TMatch - The search strategy's match type (defaults to string)
 */
export class LookaheadAsyncIterableTransformer<TState, TMatch = string>
  implements Transformer<string, string>
{
  readonly #options: LookaheadAsyncIterableTransformerOptions<TState, TMatch>;
  #engine: LookaheadEngine<TState, TMatch> | null = null;

  constructor(
    options: LookaheadAsyncIterableTransformerOptions<TState, TMatch>
  ) {
    this.#options = options;
  }

  start(controller: TransformStreamDefaultController<string>): void {
    this.#engine = new LookaheadEngine(
      this.#options,
      {
        enqueue: (chunk) => controller.enqueue(chunk),
        error: (err) => controller.error(err)
      }
    );
    this.#engine.start();
  }

  transform(chunk: string): Promise<void> {
    return this.#engine!.write(chunk);
  }

  flush(): Promise<void> {
    return this.#engine!.end();
  }
}
