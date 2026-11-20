import type { TransformEngine } from "../../engines/types.js";

function cancelled(engine: TransformEngine): boolean {
  if (!engine.cancel) return false;
  try {
    engine.cancel();
    return true;
  } catch {
    return false;
  }
}

export function enqueueOrCancel<TChunk>(
  controller: TransformStreamDefaultController<TChunk>,
  engine: TransformEngine,
  chunk: TChunk
): boolean {
  try {
    controller.enqueue(chunk);
    return true;
  } catch (refusal) {
    if (!cancelled(engine)) throw refusal;
    return false;
  }
}
