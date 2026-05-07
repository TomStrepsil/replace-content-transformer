import type { TransformEngine } from "../../engines/types.js";

export abstract class TransformerBase<T, U extends TransformEngine<T>> {
  protected readonly engine: U;

  constructor(engine: U) {
    this.engine = engine;
  }

  start(controller: TransformStreamDefaultController<string>): void {
    this.engine.start({
      enqueue: (chunk) => controller.enqueue(chunk),
      error: (err) => controller.error(err)
    });
  }

  transform(chunk: string): T {
    return this.engine.write(chunk);
  }
}
