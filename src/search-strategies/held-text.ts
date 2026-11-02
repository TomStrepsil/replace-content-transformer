const LEAST_LENGTH_TO_RELEASE = 1024;

export default class HeldText {
  takenTo = 0;
  receivedTo = 0;
  private readonly anchors: readonly string[];
  private readonly found: number[];
  private readonly searchedTo: number[];
  private readonly partialFrom: number[];
  private readonly partialCheckedTo: number[];
  private readonly minimumChunkLength: number;
  private chunks = [""];
  private offsets = [0];
  private first = 0;

  constructor(anchors: readonly string[]) {
    this.anchors = anchors;
    this.found = anchors.map(() => -1);
    this.searchedTo = anchors.map(() => 0);
    this.partialFrom = anchors.map(() => -1);
    this.partialCheckedTo = anchors.map(() => 0);
    this.minimumChunkLength = Math.max(...anchors.map(({ length }) => length)) - 1;
  }

  append(text: string): void {
    if (text === "") return;
    const last = this.chunks.length - 1;
    const heldLength = this.receivedTo - this.takenTo;
    if (heldLength <= text.length) {
      this.chunks[0] = heldLength === 0 ? text : this.slice(this.takenTo, this.receivedTo) + text;
      this.offsets[0] = this.takenTo;
      if (this.chunks.length > 1) this.chunks.length = this.offsets.length = 1;
      this.first = 0;
    } else if (this.chunks[last].length < this.minimumChunkLength) {
      this.chunks[last] += text;
    } else {
      this.chunks.push(text);
      this.offsets.push(this.receivedTo);
    }
    this.receivedTo += text.length;
  }

  find(anchorIndex: number, from: number): number {
    if (this.found[anchorIndex] >= from) return this.found[anchorIndex];
    const anchor = this.anchors[anchorIndex];
    const searchFrom = Math.max(from, this.searchedTo[anchorIndex]);
    let found = -1;
    if (searchFrom <= this.receivedTo - anchor.length) {
      if (this.chunks.length > 1) {
        found = this.indexOf(anchorIndex, searchFrom);
      } else {
        const offset = this.offsets[0];
        found = this.chunks[0].indexOf(anchor, searchFrom - offset);
        if (found !== -1) found += offset;
      }
    }
    this.found[anchorIndex] = found;
    this.searchedTo[anchorIndex] =
      found === -1 ? this.receivedTo - anchor.length + 1 : found + 1;
    return found;
  }

  takeBeforePartialAnchor(anchorIndex: number, from: number): string {
    const text = this.take(this.partialAnchorStart(anchorIndex, from));
    this.compact();
    return text;
  }

  partialAnchorStart(anchorIndex: number, from: number): number {
    const anchor = this.anchors[anchorIndex];
    let start = Math.max(from, this.receivedTo - anchor.length + 1);
    const partialFrom = this.partialFrom[anchorIndex];
    if (start <= partialFrom) {
      const checkedTo = this.partialCheckedTo[anchorIndex];
      if (anchor.startsWith(this.slice(checkedTo, this.receivedTo), checkedTo - partialFrom)) {
        this.partialCheckedTo[anchorIndex] = this.receivedTo;
        return partialFrom;
      }
      this.partialFrom[anchorIndex] = -1;
      start = partialFrom + 1;
    }
    const tail = this.slice(start, this.receivedTo);
    const firstCode = anchor.charCodeAt(0);
    for (let index = 0; index < tail.length; index++) {
      if (tail.charCodeAt(index) === firstCode && anchor.startsWith(tail.slice(index))) {
        this.partialFrom[anchorIndex] = start + index;
        this.partialCheckedTo[anchorIndex] = this.receivedTo;
        return start + index;
      }
    }
    return this.receivedTo;
  }

  slice(from: number, to: number): string {
    if (this.chunks.length === 1) {
      return this.chunks[0].slice(from - this.offsets[0], to - this.offsets[0]);
    }
    return this.sliceChunks(from, to);
  }

  take(to: number): string {
    const text = this.slice(this.takenTo, to);
    this.takenTo = to;
    if (this.chunks.length > 1) this.release(to);
    return text;
  }

  compact(): void {
    const taken = this.takenTo - this.offsets[0];
    if (
      this.chunks.length === 1 &&
      taken >= LEAST_LENGTH_TO_RELEASE &&
      taken * 2 > this.chunks[0].length
    ) {
      this.chunks[0] = structuredClone(this.chunks[0].slice(taken));
      this.offsets[0] = this.takenTo;
    }
  }

  private sliceChunks(from: number, to: number): string {
    let index = this.chunkAt(from);
    let offset = this.offsets[index];
    let text = this.chunks[index].slice(from - offset, to - offset);
    while (++index < this.chunks.length && (offset = this.offsets[index]) < to) {
      text += this.chunks[index].slice(0, to - offset);
    }
    return text;
  }

  private release(to: number): void {
    this.first = this.chunkAt(to);
    if (this.first * 2 >= this.chunks.length) {
      this.chunks.splice(0, this.first);
      this.offsets.splice(0, this.first);
      this.first = 0;
    }
  }

  private indexOf(anchorIndex: number, from: number): number {
    const anchor = this.anchors[anchorIndex];
    for (let index = this.chunkAt(from); ; index++) {
      const chunk = this.chunks[index];
      const offset = this.offsets[index];
      const searchFrom = from - offset;
      const found = chunk.indexOf(anchor, searchFrom);
      if (found !== -1) return offset + found;
      if (index + 1 === this.chunks.length) return -1;
      const straddleFrom = Math.max(searchFrom, chunk.length - anchor.length + 1);
      const straddle = (
        chunk.slice(straddleFrom) + this.chunks[index + 1].slice(0, anchor.length - 1)
      ).indexOf(anchor);
      if (straddle !== -1) return offset + straddleFrom + straddle;
    }
  }

  private chunkAt(position: number): number {
    let low = this.first;
    let high = this.chunks.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      if (this.offsets[middle] <= position) low = middle;
      else high = middle - 1;
    }
    return low;
  }
}

export function flushHeld<TState extends { held: HeldText }>(state: TState, fresh: TState): string {
  const flushed = state.held.take(state.held.receivedTo);
  Object.assign(state, fresh);
  return flushed;
}
