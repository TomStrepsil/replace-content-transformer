import { describe, it, expect } from "vitest";
import { TrailingHighSurrogateHold } from "./trailing-high-surrogate-hold.js";

describe("TrailingHighSurrogateHold", () => {
  it.each([
    { name: "the lowest high surrogate", last: "\uD800" },
    { name: "the highest high surrogate", last: "\uDBFF" }
  ])("holds back $name at the end of a chunk", ({ last }) => {
    const hold = new TrailingHighSurrogateHold();

    expect(hold.wholeCodePoints(`a${last}`)).toBe("a");
    expect(hold.remainder()).toBe(last);
  });

  it.each([
    { name: "the code unit below the high surrogates", last: "\uD7FF" },
    { name: "the lowest low surrogate", last: "\uDC00" }
  ])("passes $name through at the end of a chunk", ({ last }) => {
    const hold = new TrailingHighSurrogateHold();

    expect(hold.wholeCodePoints(`a${last}`)).toBe(`a${last}`);
    expect(hold.remainder()).toBe("");
  });

  it("prefixes the next chunk with the high surrogate it held", () => {
    const hold = new TrailingHighSurrogateHold();
    hold.wholeCodePoints("a\uD83D");

    expect(hold.wholeCodePoints("\uDE00b")).toBe("😀b");
    expect(hold.remainder()).toBe("");
  });
});
