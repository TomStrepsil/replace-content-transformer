import type { Processor } from "../../replacement-processors/types";

export abstract class ReplaceContentTransformerBase<T = string>
  implements Transformer<string, T | string>
{
  protected abstract processor: Processor;
  #cancelled = false;

  protected get cancelled(): boolean {
    return this.#cancelled;
  }

  flush(controller: TransformStreamDefaultController<T | string>) {
    const flushed = this.processor.flush();
    if (flushed) {
      controller.enqueue(flushed);
    }
  }
}
