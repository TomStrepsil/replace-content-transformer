import { Transform, type TransformCallback } from "node:stream";

interface SyncCallbackProcessor {
  processChunk(chunk: string, enqueue: (output: string) => void): void;
  flush(): string;
}

export class ReplaceContentTransformCallback extends Transform {
  readonly #processor: SyncCallbackProcessor;

  constructor(processor: SyncCallbackProcessor) {
    super();
    this.#processor = processor;
  }

  override _transform(
    chunk: Buffer | string,
    _encoding: string,
    callback: TransformCallback
  ): void {
    this.#processor.processChunk(chunk.toString(), (output) => this.push(output));
    callback();
  }

  override _flush(callback: TransformCallback): void {
    const tail = this.#processor.flush();
    if (tail) this.push(tail);
    callback();
  }
}
