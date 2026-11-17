const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;

function endsWithHighSurrogate(text: string): boolean {
  const lastCodeUnit = text.charCodeAt(text.length - 1);
  return (
    lastCodeUnit >= HIGH_SURROGATE_MIN && lastCodeUnit <= HIGH_SURROGATE_MAX
  );
}

export class TrailingHighSurrogateHold {
  #held = "";

  wholeCodePoints(chunk: string): string {
    const text = this.#held + chunk;
    const splitsPair = endsWithHighSurrogate(text);
    this.#held = splitsPair ? text.slice(-1) : "";
    return splitsPair ? text.slice(0, -1) : text;
  }

  remainder(): string {
    const held = this.#held;
    this.#held = "";
    return held;
  }
}
