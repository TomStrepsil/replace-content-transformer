/**
 * Binary min-heap with a user-supplied comparator.
 *
 * Internal utility for {@link PriorityQueueStrategy}. `pop()` always
 * returns the element for which the comparator reports the lowest value
 * relative to all others in the heap.
 *
 * `compare(a, b)` follows the {@link Array.prototype.sort} convention:
 * negative if `a` should come before `b`, positive if after, zero if equal.
 */
export class MinHeap<T> {
  readonly #data: T[] = [];
  readonly #compare: (a: T, b: T) => number;

  constructor(compare: (a: T, b: T) => number) {
    this.#compare = compare;
  }

  get size(): number {
    return this.#data.length;
  }

  push(item: T): void {
    this.#data.push(item);
    this.#siftUp(this.#data.length - 1);
  }

  pop(): T | undefined {
    const heapSize = this.#data.length;
    if (heapSize === 0) return undefined;
    const top = this.#data[0];
    const last = this.#data.pop()!;
    if (heapSize > 1) {
      this.#data[0] = last;
      this.#siftDown(0);
    }
    return top;
  }

  #siftUp(index: number): void {
    let currentIndex = index;
    while (currentIndex > 0) {
      const parentIndex = (currentIndex - 1) >> 1;
      if (this.#compare(this.#data[currentIndex], this.#data[parentIndex]) < 0) {
        this.#swap(currentIndex, parentIndex);
        currentIndex = parentIndex;
      } else {
        return;
      }
    }
  }

  #siftDown(index: number): void {
    const heapSize = this.#data.length;
    let currentIndex = index;
    while (true) {
      const left = currentIndex * 2 + 1;
      const right = left + 1;
      let smallest = currentIndex;
      if (left < heapSize && this.#compare(this.#data[left], this.#data[smallest]) < 0) {
        smallest = left;
      }
      if (right < heapSize && this.#compare(this.#data[right], this.#data[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === currentIndex) return;
      this.#swap(currentIndex, smallest);
      currentIndex = smallest;
    }
  }

  #swap(firstIndex: number, secondIndex: number): void {
    const tmp = this.#data[firstIndex];
    this.#data[firstIndex] = this.#data[secondIndex];
    this.#data[secondIndex] = tmp;
  }
}
