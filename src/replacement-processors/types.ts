export interface Processor {
  flush(): string;
}

export interface SyncProcessor extends Processor {
  processChunk(chunk: string): Generator<string, void, undefined>;
}

export interface AsyncProcessor extends Processor {
  processChunk(chunk: string): AsyncGenerator<string, void, undefined>;
}
