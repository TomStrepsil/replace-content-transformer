import { describe, it, expect } from "vitest";
import joinText from "./join-text.ts";

// Reported as https://bugs.webkit.org/show_bug.cgi?id=332729, and timed by test/benchmarks/join-text.
// Once the minimum supported Bun includes its fix, joinText() can go, and its callers can join with `+` again.

describe("joinText, which joins without `+` when one side is empty, because JavaScriptCore's optimising JIT turns a runtime empty operand into a rope that the next search copies", () => {
  it("returns the text before when the text after is empty", () => {
    expect(joinText("held", "")).toBe("held");
  });

  it("returns the text after when the text before is empty", () => {
    expect(joinText("", "chunk")).toBe("chunk");
  });

  it("joins two texts that aren't empty", () => {
    expect(joinText("held", "chunk")).toBe("heldchunk");
  });
});
