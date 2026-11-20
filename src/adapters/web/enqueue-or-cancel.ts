import type { TransformEngine } from "../../engines/types.js";

export function enqueueOrCancel<TChunk>(
  controller: TransformStreamDefaultController<TChunk>,
  engine: TransformEngine,
  chunk: TChunk
): void {
  try {
    controller.enqueue(chunk);
  } catch (error) {
    if (!engine.cancel) throw error;
    engine.cancel();
  }
}
