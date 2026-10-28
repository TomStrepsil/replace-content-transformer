/**
 * Text held back from a stream, addressed by stream position, and searchable for
 * a fixed list of anchors. Appending a chunk copies none of the text already held,
 * and each anchor's search resumes where its previous search left off, so holding
 * a long span costs time linear in its length.
 */
export default class HeldText {
  /** Stream position of the first code unit still held. */
  start = 0;
  /** Stream position just after the last code unit received. */
  end = 0;
  private readonly anchors: readonly string[];
  private readonly found: number[];
  private readonly searchedTo: number[];
  private readonly minimumChunkLength: number;
  private chunks = [""];
  private offsets = [0];
  private first = 0;

  constructor(anchors: readonly string[]) {
    this.anchors = anchors;
    this.found = anchors.map(() => -1);
    this.searchedTo = anchors.map(() => 0);
    this.minimumChunkLength = Math.max(...anchors.map(({ length }) => length)) - 1;
  }

  append(text: string): void {
    if (text === "") return;
    const last = this.chunks.length - 1;
    if (this.end - this.start <= text.length) {
      this.chunks[0] = this.slice(this.start, this.end) + text;
      this.offsets[0] = this.start;
      if (this.chunks.length > 1) this.chunks.length = this.offsets.length = 1;
      this.first = 0;
    } else if (this.chunks[last].length < this.minimumChunkLength) {
      this.chunks[last] += text;
    } else {
      this.chunks.push(text);
      this.offsets.push(this.end);
    }
    this.end += text.length;
  }

  /**
   * Stream position of the first occurrence of the anchor at `anchorIndex` at or
   * after `from`, or -1 if none has arrived yet. Successive calls for the same
   * anchor must not decrease `from`.
   */
  find(anchorIndex: number, from: number): number {
    if (this.found[anchorIndex] >= from) return this.found[anchorIndex];
    const anchor = this.anchors[anchorIndex];
    const searchFrom = Math.max(from, this.searchedTo[anchorIndex]);
    const found = this.indexOf(anchorIndex, searchFrom);
    this.found[anchorIndex] = found;
    this.searchedTo[anchorIndex] =
      found === -1 ? Math.max(searchFrom, this.end - anchor.length + 1) : found + 1;
    return found;
  }

  partialAnchorStart(anchorIndex: number, from: number): number {
    const anchor = this.anchors[anchorIndex];
    let start = Math.max(from, this.end - anchor.length + 1);
    const tail = this.slice(start, this.end);
    while (start < this.end && !anchor.startsWith(tail.slice(start - this.end))) {
      start++;
    }
    return start;
  }

  slice(from: number, to: number): string {
    let index = this.chunkAt(from);
    let offset = this.offsets[index];
    let text = this.chunks[index].slice(from - offset, to - offset);
    while (++index < this.chunks.length && (offset = this.offsets[index]) < to) {
      text += this.chunks[index].slice(0, to - offset);
    }
    return text;
  }

  take(to: number): string {
    const text = this.slice(this.start, to);
    this.start = to;
    this.first = this.chunkAt(to);
    if (this.first * 2 >= this.chunks.length) {
      this.chunks.splice(0, this.first);
      this.offsets.splice(0, this.first);
      this.first = 0;
    }
    return text;
  }

  protected search(text: string, anchorIndex: number, from: number): number {
    return text.indexOf(this.anchors[anchorIndex], from);
  }

  private indexOf(anchorIndex: number, from: number): number {
    const anchor = this.anchors[anchorIndex];
    if (from > this.end - anchor.length) return -1;
    for (let index = this.chunkAt(from); index < this.chunks.length; index++) {
      const chunk = this.chunks[index];
      const offset = this.offsets[index];
      const searchFrom = Math.max(from - offset, 0);
      const found = this.search(chunk, anchorIndex, searchFrom);
      if (found !== -1) return offset + found;
      if (index + 1 === this.chunks.length) break;
      const straddleFrom = Math.max(searchFrom, chunk.length - anchor.length + 1);
      const straddle = this.search(
        chunk.slice(straddleFrom) + this.chunks[index + 1].slice(0, anchor.length - 1),
        anchorIndex,
        0
      );
      if (straddle !== -1) return offset + straddleFrom + straddle;
    }
    return -1;
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
