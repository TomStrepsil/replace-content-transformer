import { ignore } from "./abandon.ts";

export interface CancellableRead<T> {
  readonly pieces: AsyncIterable<T>;
  cancel(): void;
}

const doneReading = { done: true, value: undefined } as const;

function readerOf<T>(stream: ReadableStream<T>): CancellableRead<T> {
  const reader = stream.getReader();
  let closed = false;
  reader.closed.then(() => {
    closed = true;
    reader.releaseLock();
  }, ignore);
  const cancel = () => {
    reader.cancel().catch(ignore);
  };
  const iterator: AsyncIterableIterator<T> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: () => (closed ? Promise.resolve(doneReading) : (reader.read() as Promise<IteratorResult<T>>)),
    return() {
      cancel();
      return Promise.resolve(doneReading);
    }
  };
  return { pieces: iterator, cancel };
}

function iteratorOf<T>(source: AsyncIterable<T>): CancellableRead<T> {
  const iterator = source[Symbol.asyncIterator]();
  return { pieces: { [Symbol.asyncIterator]: () => iterator }, cancel: ignore };
}

export function cancellableRead<T>(source: AsyncIterable<T>): CancellableRead<T> {
  return source instanceof ReadableStream ? readerOf(source) : iteratorOf(source);
}

export function cancellableForAwait<T>(source: AsyncIterable<T>): CancellableRead<T> {
  return source instanceof ReadableStream ? readerOf(source) : { pieces: source, cancel: ignore };
}
