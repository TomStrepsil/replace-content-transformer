import type { SyncTransformEngine, AsyncTransformEngine, EngineSink } from "../../src/engines/types.ts";

function makeSink(controller: EngineSink): EngineSink {
  return controller;
}

export function syncHarnessTransformer(engine: SyncTransformEngine) {
  let started = false;
  function ensureStarted(controller: EngineSink) {
    if (!started) { engine.start(makeSink(controller)); started = true; }
  }
  return {
    transform(chunk: string, controller: EngineSink) {
      ensureStarted(controller);
      engine.write(chunk);
    },
    flush(controller: EngineSink) {
      ensureStarted(controller);
      engine.end();
    }
  };
}

export function asyncHarnessTransformer(engine: AsyncTransformEngine) {
  let started = false;
  function ensureStarted(controller: EngineSink) {
    if (!started) { engine.start(makeSink(controller)); started = true; }
  }
  return {
    transform(chunk: string, controller: EngineSink) {
      ensureStarted(controller);
      return engine.write(chunk);
    },
    flush(controller: EngineSink) {
      ensureStarted(controller);
      return engine.end();
    }
  };
}

export function callbackProcessorToEngine(processor: {
  processChunk(chunk: string, enqueue: (out: string) => void): void;
  flush(): string;
}): SyncTransformEngine {
  let sink: EngineSink;
  return {
    start(s) { sink = s; },
    write(chunk) { processor.processChunk(chunk, (out) => sink.enqueue(out)); },
    end() { const flushed = processor.flush(); if (flushed) sink.enqueue(flushed); }
  };
}

export function generatorProcessorToEngine(processor: {
  processChunk(chunk: string): Generator<string, void, undefined>;
  flush(): string;
}): SyncTransformEngine {
  let sink: EngineSink;
  return {
    start(s) { sink = s; },
    write(chunk) { for (const out of processor.processChunk(chunk)) sink.enqueue(out); },
    end() { const flushed = processor.flush(); if (flushed) sink.enqueue(flushed); }
  };
}

export function legacyTransformerToEngine(transformer: {
  transform(chunk: string, controller: { enqueue(chunk: string): void }): void;
  flush(controller: { enqueue(chunk: string): void }): void;
}): SyncTransformEngine {
  let sink: EngineSink;
  const controller = { enqueue: (chunk: string) => sink.enqueue(chunk) };
  return {
    start(s) { sink = s; },
    write(chunk) { transformer.transform(chunk, controller); },
    end() { transformer.flush(controller); }
  };
}
