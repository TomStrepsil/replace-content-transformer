import type { MatchSink } from "./types.js";
import joinText from "./join-text.js";

export default class HeldText<TMatch = string> {
  text = "";
  reportedTo = 0;
  #streamOffset = 0;
  #sink!: MatchSink<TMatch>;

  scan(chunk: string, sink: MatchSink<TMatch>, scanner: () => void): void {
    this.text = joinText(this.text, chunk);
    this.#sink = sink;
    try {
      scanner();
    } finally {
      this.#streamOffset += this.reportedTo;
      this.text = this.text.slice(this.reportedTo);
      this.reportedTo = 0;
    }
  }

  hold(chunk: string): void {
    this.text = joinText(this.text, chunk);
  }

  streamIndex(position: number): number {
    return this.#streamOffset + position;
  }

  reportText(to: number): void {
    const from = this.reportedTo;
    if (to === from) return;
    this.reportedTo = to;
    this.#sink.reportText(this.text.slice(from, to));
  }

  reportMatch(match: TMatch, to: number): boolean {
    const from = this.reportedTo;
    this.reportedTo = to;
    return this.#sink.reportMatch(match, [this.#streamOffset + from, this.#streamOffset + to]);
  }

  flush(): string {
    const held = this.text;
    this.text = "";
    this.#streamOffset = 0;
    return held;
  }
}
