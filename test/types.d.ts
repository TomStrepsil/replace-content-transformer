export interface Chunk {
  output: string;
  timing: number;
}

export interface Result {
  finalOutput: string;
  chunksReceived: Chunk[];
}
