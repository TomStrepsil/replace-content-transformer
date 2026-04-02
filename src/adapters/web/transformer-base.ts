import type { Processor } from "../../replacement-processors/types.ts";
export abstract class ReplaceContentTransformerBase<T = string>
  implements Transformer<string, T | string>
{
  protected abstract processor: Processor;

  flush(controller: TransformStreamDefaultController<T | string>) {
    const flushed = this.processor.flush();
    if (flushed) {
      controller.enqueue(flushed);
    }
  }
}
