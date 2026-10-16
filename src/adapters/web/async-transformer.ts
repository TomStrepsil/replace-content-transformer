import type { AsyncTransformEngine } from "../../index.js";
import { TransformerBase } from "./transformer-base.js";

/**
 * An asynchronous transformer for the WHATWG Streams API that replaces
 * content in streaming text.
 *
 * Accepts any {@link AsyncTransformEngine} — use
 * {@link AsyncSerialReplacementTransformEngine} for serial async replacements,
 * or {@link AsyncLookaheadTransformEngine} for concurrent pipelined replacements
 * with pluggable concurrency control.
 *
 * @remarks **Encoding**: see {@link TransformerBase}.
 *
 * @example Serial async replacement
 * ```typescript
 * const transformer = new AsyncReplaceContentTransformer(
 *   new AsyncSerialReplacementTransformEngine({
 *     searchStrategy,
 *     replacement: async (match) => (await kv.get(match)) ?? ""
 *   })
 * );
 * ```
 *
 * @example Pipelined lookahead replacement
 * ```typescript
 * const transformer = new AsyncReplaceContentTransformer(
 *   new AsyncLookaheadTransformEngine({
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
    return await this._engine.end();
  }
}
