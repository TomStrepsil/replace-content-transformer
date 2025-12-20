import type { Processor } from "../types";

export interface SyncCallbackProcessor<
  T extends string | Promise<string> = string
> extends Processor {
  processChunk(chunk: string, enqueue: (output: T | string) => void): void;
}

export interface AsyncCallbackProcessor extends Processor {
  processChunk(chunk: string, enqueue: (output: string) => void): Promise<void>;
}
