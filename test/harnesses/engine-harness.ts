import type { SyncTransformEngine, AsyncTransformEngine, EngineSink } from "../../src/engines/types.ts";

export function syncHarnessTransformer(engine: SyncTransformEngine) {
  let started = false;
  function ensureStarted(controller: EngineSink) {
    if (!started) { engine.start(controller); started = true; }
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
    if (!started) { engine.start(controller); started = true; }
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

export function callbackHarnessTransformer(processor: {
  processChunk(chunk: string, enqueue: (out: string) => void): void;
  flush(): string;
}) {
  let enqueue: (out: string) => void;
  return {
    transform(chunk: string, controller: EngineSink) {
      if (!enqueue) enqueue = (out) => controller.enqueue(out);
      processor.processChunk(chunk, enqueue);
    },
    flush(controller: EngineSink) {
      const flushed = processor.flush();
      if (flushed) controller.enqueue(flushed);
    }
  };
}

export function generatorHarnessTransformer(processor: {
  processChunk(chunk: string): Generator<string, void, undefined>;
  flush(): string;
}) {
  return {
    transform(chunk: string, controller: EngineSink) {
      for (const out of processor.processChunk(chunk)) controller.enqueue(out);
    },
    flush(controller: EngineSink) {
      const flushed = processor.flush();
      if (flushed) controller.enqueue(flushed);
    }
  };
}

export function legacyHarnessTransformer(transformer: {
  transform(chunk: string, controller: { enqueue(chunk: string): void }): void;
  flush(controller: { enqueue(chunk: string): void }): void;
}) {
  let controller: { enqueue(chunk: string): void };
  function ensureController(sink: EngineSink) {
    if (!controller) controller = { enqueue: (c) => sink.enqueue(c) };
  }
  return {
    transform(chunk: string, sink: EngineSink) {
      ensureController(sink);
      transformer.transform(chunk, controller);
    },
    flush(sink: EngineSink) {
      ensureController(sink);
      transformer.flush(controller);
    }
  };
}
