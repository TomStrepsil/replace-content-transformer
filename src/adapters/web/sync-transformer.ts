import { ReplaceContentTransformerBase } from "./transformer-base.js";
import type { SyncProcessor } from "../../replacement-processors/types.js";

/**
 * A synchronous transformer for the WHATWG Streams API that replaces
 * content in streaming text.
 *
 * For async replacement use cases, see:
 * - {@link AsyncReplaceContentTransformer} — serial async replacement.
 * - {@link LookaheadAsyncIterableTransformer} — pipelined async
 *   replacement with pluggable concurrency control and in-order output.
 *
 * @example
 * ```typescript
 * const transformer = new ReplaceContentTransformer(
 *   new StaticReplacementProcessor({ searchStrategy, replacement: "NEW" })
 * );
 * ```
 */
export class ReplaceContentTransformer extends ReplaceContentTransformerBase<string> {
  protected processor: SyncProcessor;
  #stopReplacingSignal?: AbortSignal;
  #didFlushAfterAbort = false;

  #flushAfterAbortIfNeeded(
    controller: TransformStreamDefaultController<string>
  ) {
    if (this.#didFlushAfterAbort || !this.#stopReplacingSignal?.aborted) {
      return;
    }

    this.#didFlushAfterAbort = true;
    this.flush(controller);
  }

  constructor(processor: SyncProcessor, stopReplacingSignal?: AbortSignal) {
    super();
    this.#stopReplacingSignal = stopReplacingSignal;
    this.processor = processor;
  }

  transform(
    chunk: string,
    controller: TransformStreamDefaultController<string>
  ) {
    if (this.#stopReplacingSignal?.aborted) {
      this.#flushAfterAbortIfNeeded(controller);
      controller.enqueue(chunk);
      return;
    }

    for (const output of this.processor.processChunk(chunk)) {
      controller.enqueue(output);

      if (this.#stopReplacingSignal?.aborted) {
        break;
      }
    }

    this.#flushAfterAbortIfNeeded(controller);
  }
}
