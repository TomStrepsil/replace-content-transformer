export interface Processor {
  flush(): string;
}

export interface SyncProcessor<T extends string | Promise<string> = string>
  extends Processor {
  processChunk(chunk: string): Generator<T | string, void, undefined>;
}

export interface AsyncProcessor extends Processor {
  processChunk(chunk: string): AsyncGenerator<string, void, undefined>;
}
