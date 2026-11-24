import type { TransformEngine } from "../../engines/types.js";

export const HIGH_WATER_MARK = 64 * 1024;

export type RoomFor = (desiredSize: number, writtenLength: number) => number;

export const roomInChunks: RoomFor = (desiredSize, writtenLength) => desiredSize * writtenLength;

export function countsChunks(strategy: QueuingStrategy<never>): boolean {
  return strategy.size === undefined || strategy instanceof CountQueuingStrategy;
}

interface PairedTransformer<TInput, TOutput> {
  start(controller: Pick<TransformStreamDefaultController<TOutput>, "enqueue" | "error">): void;
  transform(chunk: TInput): void | Promise<void>;
  flush(): void | Promise<void>;
  cancel(reason?: unknown): void;
}

export function transformerPair<TInput, TOutput>(
  engine: TransformEngine,
  transformerFor: (engine: TransformEngine) => PairedTransformer<TInput, TOutput>,
  writableStrategy: QueuingStrategy<TInput> | undefined,
  readableStrategy: QueuingStrategy<TOutput>,
  roomFor: RoomFor | undefined
): ReadableWritablePair<TOutput, TInput> {
  let readableController!: ReadableStreamDefaultController<TOutput>;
  let writableController!: WritableStreamDefaultController;
  let cancelled: { reason: unknown } | undefined;
  let resume: (() => void) | undefined;
  let resumed: Promise<void> | undefined;
  let resumeAt = 0;
  let writtenLength = 0;
  let readWaiting = false;
  const pulled = () => {
    resume?.();
    resumed = undefined;
  };
  const ready = () =>
    readWaiting || readableController.desiredSize! > 0
      ? undefined
      : (resumed ??= new Promise((resolve) => (resume = resolve)));
  const room = roomFor && (() => roomFor(readableController.desiredSize!, writtenLength));
  const transformer = transformerFor({
    start: (sink) => engine.start({ ...sink, ready, room, roomCountsChunks: roomFor === roomInChunks }),
    write: (chunk) => {
      writtenLength = chunk.length;
      return engine.write(chunk);
    },
    end: engine.end.bind(engine),
    cancel: engine.cancel?.bind(engine)
  });
  const failed = (error: unknown): never => {
    readableController.error(error);
    throw error;
  };
  const erroringReadableOnThrow = (call: () => void | Promise<void>): void | Promise<void> => {
    let result: void | Promise<void>;
    try {
      result = call();
    } catch (error) {
      return failed(error);
    }
    return result && result.catch(failed);
  };
  const transform = (chunk: TInput) => {
    if (cancelled) throw cancelled.reason;
    return erroringReadableOnThrow(() => transformer.transform(chunk));
  };
  const release = (reason: unknown) => {
    cancelled = { reason };
    readableController.error(reason);
    pulled();
  };
  const stop = (reason: unknown) => {
    if (cancelled) return;
    release(reason);
    transformer.cancel(reason);
  };
  const errored = (reason: unknown) => {
    writableController.error(reason);
    release(reason);
  };
  let cancelFailure: { error: unknown } | undefined;
  const readable = new ReadableStream<TOutput>(
    {
      start: (controller) => {
        readableController = controller;
        resumeAt = controller.desiredSize! / 2;
      },
      pull: () => {
        if (readableController.desiredSize! < resumeAt) return;
        readWaiting = true;
        pulled();
      },
      cancel: (reason) => {
        writableController.error(reason);
        stop(reason);
      }
    },
    readableStrategy
  );
  const writable = new WritableStream<TInput>({
    start: (controller) => {
      writableController = controller;
      controller.signal?.addEventListener(
        "abort",
        () => {
          try {
            stop(controller.signal.reason);
          } catch (error) {
            cancelFailure = { error };
          }
        },
        { once: true }
      );
    },
    write: (chunk) => {
      const waiting = ready();
      return waiting ? waiting.then(() => transform(chunk)) : transform(chunk);
    },
    close: async () => {
      await erroringReadableOnThrow(() => transformer.flush());
      if (!cancelled) readableController.close();
    },
    abort: (reason) => {
      if (cancelFailure) throw cancelFailure.error;
      stop(reason);
    }
  }, writableStrategy);
  transformer.start({
    enqueue: (chunk) => {
      readWaiting = false;
      try {
        readableController.enqueue(chunk);
      } catch (refusal) {
        errored(refusal);
        throw refusal;
      }
    },
    error: errored
  });
  return { readable, writable };
}
