import { Transform, type TransformCallback } from "node:stream";
import type { Processor } from "../../replacement-processors/types";

export abstract class ReplaceContentTransformBase extends Transform {
  protected abstract processor: Processor;
  #cancelled = false;

  protected get cancelled(): boolean {
    return this.#cancelled;
  }

  protected flush(callback: TransformCallback) {
    const flushed = this.processor.flush();
    if (flushed) {
      this.push(flushed);
    }
    callback();
  }

  /**
   * Called by the stream infrastructure when the readable side is cancelled or
   * the writable side is aborted. Sets an internal flag so that an in-flight
   * async {@link AsyncReplaceContentTransformer.transform | transform()} can
   * stop enqueuing at the next yield boundary.
   *
   * **External resource cancellation** — `cancel()` cannot reach into a
   * pending replacement function (e.g. an in-flight `fetch`). To cancel
   * those, share an `AbortController` between your replacement function and
   * the code that tears down the stream:
   *
   * ```typescript
   * const ac = new AbortController();
   *
   * const transformer = new AsyncReplaceContentTransformer(
   *   new AsyncFunctionReplacementProcessor({
   *     searchStrategy,
   *     replacement: async (match) => {
   *       const res = await fetch(`/api/${match}`, { signal: ac.signal });
   *       return res.text();
   *     }
   *   })
   * );
   *
   * // To cancel everything:
   * ac.abort();                       // cancels in-flight fetches
   * await readable.cancel("done");    // tears down the stream → cancel() called
   * ```
   */
  cancel() {
    this.#cancelled = true;
  }
}
