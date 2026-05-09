import type { SyncTransformEngine } from "../../index.js";
import { TransformerBase } from "./transformer-base.js";

/**
 * A synchronous transformer for the WHATWG Streams API that replaces
 * content in streaming text.
 *
 * Accepts any {@link SyncTransformEngine} — use
 * {@link SyncReplacementTransformEngine} for string, iterable, or static
 * replacements.
 *
 * For async replacement use cases, see {@link AsyncReplaceContentTransformer}.
 *
 * @example
 * ```typescript
 * import { SyncReplacementTransformEngine } from 'replace-content-transformer';
 * import { ReplaceContentTransformer } from 'replace-content-transformer/web';
 *
 * const transformer = new ReplaceContentTransformer(
 *   new SyncReplacementTransformEngine({ searchStrategy, replacement: "NEW" })
 * );
 * const stream = new TransformStream(transformer);
 * ```
 */
export class ReplaceContentTransformer extends TransformerBase<
  void,
  SyncTransformEngine
> {
  flush(): void {
    return this._engine.end();
  }
}
