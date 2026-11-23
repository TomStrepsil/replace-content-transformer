import { describe, expect, it } from "vitest";
import transform from "./report-replacement-contexts.js";
import { runner } from "./test-harness.js";

const run = runner(transform);

describe("replacement context report", () => {
  it("never edits the file", () => {
    const { output } = run("replacement(match, { matchIndex: 0, streamIndices: [0, 5] });");

    expect(output).toBeNull();
  });

  it("reports a context built without a signal, such as in a test calling a replacement directly", () => {
    const { reports } = run("", "replacement(match, { matchIndex: 0, streamIndices: [0, 5] });");

    expect(reports).toEqual([
      expect.stringContaining("line 2: `{ matchIndex: 0, streamIndices: [0, 5] }` builds a ReplacementContext without the signal 4.0 requires")
    ]);
  });

  it("reports a context a custom engine builds", () => {
    const { report } = run(
      "class Engine {",
      "  #call(match, streamIndices) {",
      "    return this.replacement(match, { matchIndex: this.matchIndex++, streamIndices });",
      "  }",
      "}"
    );

    expect(report).toContain("line 3:");
  });

  it("stays quiet about a context that has a signal", () => {
    const { reports } = run("replacement(match, { matchIndex: 0, streamIndices: [0, 5], signal });");

    expect(reports).toEqual([]);
  });

  it("stays quiet about a context spread from another, which may carry the signal", () => {
    const { reports } = run("replacement(match, { ...context, matchIndex: 0, streamIndices: [0, 5] });");

    expect(reports).toEqual([]);
  });

  it("stays quiet about an object that has only one of a context's fields", () => {
    const { reports } = run("log({ matchIndex: 0 });");

    expect(reports).toEqual([]);
  });

  it("stays quiet about a destructured context parameter", () => {
    const { reports } = run("const replacement = (match, { matchIndex, streamIndices }) => `${matchIndex}`;");

    expect(reports).toEqual([]);
  });
});
