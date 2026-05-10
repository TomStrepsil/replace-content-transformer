import { describe, expect, it } from "vitest";
import jscodeshift from "jscodeshift";
import transform from "./replacement-callback-positional-to-context.js";

function runTransform(source) {
  // The 3rd argument represents CLI options passed to jscodeshift transforms.
  // It's optional, but passing an empty object keeps helper calls signature-complete.
  return transform(
    {
      path: "fixture.ts",
      source,
    },
    {
      jscodeshift,
      j: jscodeshift,
      stats: () => undefined,
      report: () => undefined,
    },
    {}
  );
}

describe("replacement-callback-positional-to-context codemod", () => {
  it("handles the original positional migration case with aliased names", () => {
    const input = [
      "const engine = new FunctionReplacementProcessor({",
      "  replacement: (match, index, range) => `${index}:${range[0]}:${match}`",
      "});",
      "",
    ].join("\n");

    const output = runTransform(input);

    expect(output).not.toBeNull();
    expect(output).toContain("matchIndex: index");
    expect(output).toContain("streamIndices: range");
    expect(output).toContain("=> `${index}:${range[0]}:${match}`");
  });

  it("uses shorthand when positional args are already matchIndex and streamIndices", () => {
    const input = [
      "const engine = new FunctionReplacementProcessor({",
      "  replacement: (match, matchIndex, streamIndices) => `${matchIndex}:${streamIndices[0]}:${match}`",
      "});",
      "",
    ].join("\n");

    const output = runTransform(input);

    expect(output).not.toBeNull();
    expect(output).toContain("matchIndex");
    expect(output).toContain("streamIndices");
    expect(output).toContain("=> `${matchIndex}:${streamIndices[0]}:${match}`");
  });

  it("skips when streamIndices positional arg is destructured inline", () => {
    const input = [
      "const engine = new FunctionReplacementProcessor({",
      "  replacement: (match, matchIndex, [startIndex, endIndex]) => `${matchIndex}:${startIndex}:${endIndex}:${match}`",
      "});",
      "",
    ].join("\n");

    const output = runTransform(input);

    expect(output).toBeNull();
  });

  it("migrates two-argument positional callbacks", () => {
    const input = [
      "const engine = new FunctionReplacementProcessor({",
      "  replacement: (match, index) => `${index}:${match}`",
      "});",
      "",
    ].join("\n");

    const output = runTransform(input);

    expect(output).not.toBeNull();
    expect(output).toContain("matchIndex: index");
    expect(output).not.toContain("streamIndices");
  });

  it("migrates function-expression callbacks", () => {
    const input = [
      "const engine = new FunctionReplacementProcessor({",
      "  replacement: function (match, index, range) {",
      "    return `${index}:${range[0]}:${match}`;",
      "  }",
      "});",
      "",
    ].join("\n");

    const output = runTransform(input);

    expect(output).not.toBeNull();
    expect(output).toContain("replacement: function(");
    expect(output).toContain("matchIndex: index");
    expect(output).toContain("streamIndices: range");
  });

  it("returns null when callback already uses context-object style", () => {
    const input = [
      "const engine = new FunctionReplacementProcessor({",
      "  replacement: (match, { matchIndex, streamIndices }) => `${matchIndex}:${streamIndices[0]}:${match}`",
      "});",
      "",
    ].join("\n");

    const output = runTransform(input);

    expect(output).toBeNull();
  });

  it("applies supported changes while leaving unsupported callbacks untouched", () => {
    const input = [
      "const a = new FunctionReplacementProcessor({",
      "  replacement: (match, index, range) => `${index}:${range[0]}:${match}`",
      "});",
      "const b = new FunctionReplacementProcessor({",
      "  replacement: (match, matchIndex, [startIndex, endIndex]) => `${matchIndex}:${startIndex}:${endIndex}:${match}`",
      "});",
      "",
    ].join("\n");

    const output = runTransform(input);

    expect(output).not.toBeNull();
    expect(output).toContain("matchIndex: index");
    expect(output).toContain("replacement: (match, matchIndex, [startIndex, endIndex])");
  });

  it("does not transform callbacks on non-replacement properties", () => {
    const input = [
      "const obj = {",
      "  notReplacement: (match, index, range) => `${index}:${range[0]}:${match}`",
      "};",
      "",
    ].join("\n");

    const output = runTransform(input);

    expect(output).toBeNull();
  });

  it("does not throw or modify when replacement property is non-function", () => {
    const input = [
      "const engine = new FunctionReplacementProcessor({",
      "  replacement: \"fixed value\"",
      "});",
      "",
    ].join("\n");

    expect(() => runTransform(input)).not.toThrow();
    expect(runTransform(input)).toBeNull();
  });

  it("skips callbacks with unsupported arity", () => {
    const oneArg = [
      "const p1 = new FunctionReplacementProcessor({",
      "  replacement: (match) => match",
      "});",
      "",
    ].join("\n");

    const fourArgs = [
      "const p2 = new FunctionReplacementProcessor({",
      "  replacement: (match, i, r, extra) => `${i}:${r}:${extra}:${match}`",
      "});",
      "",
    ].join("\n");

    expect(runTransform(oneArg)).toBeNull();
    expect(runTransform(fourArgs)).toBeNull();
  });

  it("supports assignment pattern positional arguments", () => {
    const input = [
      "const engine = new FunctionReplacementProcessor({",
      "  replacement: (match, index = 0, range = [0, 0]) => `${index}:${range[0]}:${match}`",
      "});",
      "",
    ].join("\n");

    const output = runTransform(input);

    expect(output).not.toBeNull();
    expect(output).toContain("matchIndex: index = 0");
    expect(output).toContain("streamIndices: range = [0, 0]");
  });
});
