/**
 * A counting semaphore with a FIFO waiting queue.
 *
 * Allows up to `concurrency` simultaneous holders. When the limit is
 * reached, further `acquire()` calls suspend until a holder calls
 * `release()`.
 *
 * Not a general-purpose primitive — designed for internal use by
 * concurrency strategies. Acquires and releases must be balanced by the
 * caller; excess releases silently add capacity up to future acquires.
 */
export class Semaphore {
  #available: number;
  readonly #waiting: Array<() => void> = [];

  constructor(concurrency: number) {
    this.#available = concurrency;
  }

  async acquire(): Promise<void> {
    if (this.#available > 0) {
      this.#available--;
      return;
    }
    await new Promise<void>((resolve) => this.#waiting.push(resolve));
  }

  release(): void {
    const next = this.#waiting.shift();
    if (next) {
      next();
      return;
    }
    this.#available++;
  }
}
