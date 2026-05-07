import type { AsyncTransformEngine } from "../../index.js";
import { TransformerBase } from "./transformer-base.js";

/**
 * An asynchronous transformer for the WHATWG Streams API that replaces
 * content in streaming text.
 *
 * Accepts any {@link AsyncTransformEngine} — use
 * {@link AsyncSerialTransformEngine} for serial async replacements, or
 * {@link LookaheadTransformEngine} for concurrent pipelined replacements
 * with pluggable concurrency control.
 *
 * @example Serial async replacement
 * ```typescript
 * const transformer = new AsyncReplaceContentTransformer(
 *   new AsyncSerialTransformEngine({
 *     searchStrategy,
 *     replacement: async (match) => (await kv.get(match)) ?? ""
 *   })
 * );
 * ```
 *
 * @example Pipelined lookahead replacement
 * ```typescript
 * const transformer = new AsyncReplaceContentTransformer(
 *   new LookaheadTransformEngine({
 *     searchStrategy,
 *     replacement: async (match) => {
 *       const res = await fetch(`/api/${match}`);
 *       return res.body!.pipeThrough(new TextDecoderStream());
 *     },
 *     concurrencyStrategy: new SemaphoreStrategy(8)
 *   })
 * );
 * ```
 */
export class AsyncReplaceContentTransformer
  extends TransformerBase<Promise<void>, AsyncTransformEngine>
{
  async flush(): Promise<void> {
    return await this.engine.end();
  }

  /**
   * Called by the stream infrastructure when the readable side is cancelled
   * or the writable side is aborted. Forwards to the engine's cancel() if
   * present so in-flight async work can stop at the next yield boundary.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- accepted for WHATWG callback compat
  cancel(reason?: unknown): void {
    this.engine.cancel?.();
  }
}
