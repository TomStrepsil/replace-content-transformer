import { Transform, type TransformCallback } from "node:stream";

interface AsyncCallbackProcessor {
  processChunk(chunk: string, enqueue: (output: string) => void): Promise<void>;
  flush(): string;
}

export class AsyncReplaceContentTransformCallback extends Transform {
  readonly #processor: AsyncCallbackProcessor;

  constructor(processor: AsyncCallbackProcessor) {
    super();
    this.#processor = processor;
  }

  override _transform(
    chunk: Buffer | string,
    _encoding: string,
    callback: TransformCallback
  ): void {
    this.#processor
      .processChunk(chunk.toString(), (output) => this.push(output))
      .then(() => callback())
      .catch(callback);
  }

  override _flush(callback: TransformCallback): void {
    const tail = this.#processor.flush();
    if (tail) this.push(tail);
    callback();
  }
}
