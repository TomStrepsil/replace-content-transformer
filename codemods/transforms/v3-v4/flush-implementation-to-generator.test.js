import { describe, expect, it } from "vitest";
import jscodeshift from "jscodeshift";

const tsx = jscodeshift.withParser("tsx");
import transform from "./flush-implementation-to-generator.js";

function runTransform(source, reports = []) {
  return transform(
    { path: "fixture.ts", source },
    {
      jscodeshift: tsx,
      j: tsx,
      stats: () => undefined,
      report: (message) => reports.push(message)
    },
    {}
  );
}

describe("flush-implementation-to-generator codemod", () => {
  it("rewrites the mechanical buffer-returning implementation", () => {
    const output = runTransform(
      [
        "class S extends Base {",
        "  flush(state: StringBufferState): string {",
        "    const flushed = state.buffer;",
        '    state.buffer = "";',
        "    return flushed;",
        "  }",
        "}",
        ""
      ].join("\n")
    );

    expect(output).toContain("*flush(");
    expect(output).toContain(
      "Generator<MatchResult<string>, void, undefined>"
    );
    expect(output).toContain("if (flushed)");
    expect(output).toContain('isMatch: false');
    expect(output).toContain("content: flushed");
    expect(output).not.toContain("return flushed");
  });

  it("turns delegation to another flush into yield*", () => {
    const output = runTransform(
      [
        "class S extends Base {",
        "  flush(state: State): string {",
        "    state.needleIndex = 0;",
        "    return super.flush(state);",
        "  }",
        "}",
        ""
      ].join("\n")
    );

    expect(output).toContain("yield* super.flush(state)");
    expect(output).not.toContain("return super.flush");
  });

  it("leaves a subclass that inherits flush untouched", () => {
    const output = runTransform(
      ["class S extends Base {", "  createState() {", "    return {};", "  }", "}", ""].join("\n")
    );

    expect(output).toBeNull();
  });

  it("leaves an already-migrated generator untouched", () => {
    const output = runTransform(
      [
        "class S extends Base {",
        "  *flush(state: State): Generator<MatchResult, void, undefined> {",
        "    yield* super.flush(state);",
        "  }",
        "}",
        ""
      ].join("\n")
    );

    expect(output).toBeNull();
  });

  it("reports rather than mangles an implementation that composes its result", () => {
    const reports = [];
    const output = runTransform(
      [
        "class S extends Base {",
        "  flush(state: State): string {",
        "    const flushed = state.balancedBuffer;",
        "    return flushed + this.inner.flush(state);",
        "  }",
        "}",
        ""
      ].join("\n"),
      reports
    );

    expect(output).toBeNull();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("composes its result");
  });

  it("reports rather than mangles a non-string return type", () => {
    const reports = [];
    const output = runTransform(
      [
        "class S extends Base {",
        "  flush(state: State): string[] {",
        "    return [state.buffer];",
        "  }",
        "}",
        ""
      ].join("\n"),
      reports
    );

    expect(output).toBeNull();
    expect(reports[0]).toContain("non-string return type");
  });
});
