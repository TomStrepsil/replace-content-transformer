import type { TransformEngine } from "../../engines/types.js";

export abstract class TransformerBase<T, U extends TransformEngine<T>> {
  protected readonly _engine: U;

  constructor(engine: U) {
    this._engine = engine;
  }

  start(controller: TransformStreamDefaultController<string>): void {
    this._engine.start({
      enqueue: (chunk) => controller.enqueue(chunk),
      error: (err) => controller.error(err)
    });
  }

  transform(chunk: string): T {
    return this._engine.write(chunk);
  }
}
