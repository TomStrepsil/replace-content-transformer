import type { Processor } from "../types.js";

export interface SyncCallbackProcessor extends Processor {
  processChunk(chunk: string, enqueue: (output: string) => void): void;
}

export interface AsyncCallbackProcessor extends Processor {
  processChunk(chunk: string, enqueue: (output: string) => void): Promise<void>;
}
