import type { CancellableRead } from "../cancellable-read.ts";
import type { Utf8Bytes } from "../types.ts";

export class LivePermits {
  #first: SlotPermit | undefined = undefined;
  #last: SlotPermit | undefined = undefined;

  add(permit: SlotPermit): void {
    const last = this.#last;
    permit.previous = last;
    if (last === undefined) this.#first = permit;
    else last.next = permit;
    this.#last = permit;
  }

  #has(permit: SlotPermit): boolean {
    return permit.previous !== undefined || this.#first === permit;
  }

  delete(permit: SlotPermit): void {
    if (!this.#has(permit)) return;
    const { previous, next } = permit;
    if (previous === undefined) this.#first = next;
    else previous.next = next;
    if (next === undefined) this.#last = previous;
    else next.previous = previous;
    permit.previous = undefined;
    permit.next = undefined;
  }

  forEach(action: (permit: SlotPermit) => void): void {
    let permit = this.#first;
    while (permit !== undefined) {
      const next = permit.next;
      action(permit);
      permit = next;
    }
  }
}

export class SlotPermit {
  previous: SlotPermit | undefined = undefined;
  next: SlotPermit | undefined = undefined;
  streaming = false;
  reading: CancellableRead<string | Utf8Bytes> | undefined = undefined;
  readonly signal: AbortSignal;
  #acquired: (() => void) | undefined;
  readonly #controller: AbortController | undefined;
  readonly #live: LivePermits;

  constructor(
    acquired: () => void,
    live: LivePermits,
    cancelSignal: AbortSignal,
    controller: AbortController | undefined
  ) {
    this.#acquired = acquired;
    this.#live = live;
    this.#controller = controller;
    this.signal = controller === undefined ? cancelSignal : controller.signal;
    live.add(this);
  }

  abandon(): void {
    if (!this.streaming) this.abort();
  }

  abort(): void {
    this.#controller?.abort();
    this.finish();
  }

  releaseSlot(): void {
    const acquired = this.#acquired;
    if (acquired === undefined) return;
    this.#acquired = undefined;
    acquired();
  }

  finish(): void {
    this.#live.delete(this);
    this.releaseSlot();
  }
}
