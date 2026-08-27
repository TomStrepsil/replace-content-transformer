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
        "class S extends StringBufferStrategyBase {",
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
        "class S extends StringBufferStrategyBase {",
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
      ["class S extends StringBufferStrategyBase {", "  createState() {", "    return {};", "  }", "}", ""].join("\n")
    );

    expect(output).toBeNull();
  });

  it("leaves an already-migrated generator untouched", () => {
    const output = runTransform(
      [
        "class S extends StringBufferStrategyBase {",
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
        "class S extends StringBufferStrategyBase {",
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
        "class S extends StringBufferStrategyBase {",
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
  it("leaves a flush() that is not a search strategy's alone", () => {
    const reports = [];
    const output = runTransform(
      [
        "class Cache {",
        "  flush(): string {",
        "    return this.buffered;",
        "  }",
        "}",
        ""
      ].join("\n"),
      reports
    );

    expect(output).toBeNull();
    expect(reports.join("\n")).toContain("not identifiably a SearchStrategy");
  });

  it("leaves returns inside nested functions alone", () => {
    const output = runTransform(
      [
        "class S implements SearchStrategy<State, string> {",
        "  flush(state: State): string {",
        "    const parts = state.items.map(function (item) {",
        "      return item.text;",
        "    });",
        "    return parts.join(\"\");",
        "  }",
        "}",
        ""
      ].join("\n")
    );

    expect(output).toContain("return item.text");
    expect(output).toContain("yield");
  });

  it("terminates the generator where a return was not the last statement", () => {
    const output = runTransform(
      [
        "class S implements SearchStrategy<State, string> {",
        "  flush(state: State): string {",
        "    if (state.cached) return state.cached;",
        "    return state.buffer;",
        "  }",
        "}",
        ""
      ].join("\n")
    );

    expect(output).toMatch(/yield[\s\S]*?return;/);
  });

  it("takes the match type from the implemented interface", () => {
    const output = runTransform(
      [
        "class S implements SearchStrategy<State, RegExpExecArray> {",
        "  flush(state: State): string {",
        "    return state.buffer;",
        "  }",
        "}",
        ""
      ].join("\n")
    );

    expect(output).toContain(
      "Generator<MatchResult<RegExpExecArray>, void, undefined>"
    );
  });

  it("reports when MatchResult is not already imported", () => {
    const reports = [];
    runTransform(
      [
        "class S implements SearchStrategy<State, string> {",
        "  flush(state: State): string {",
        "    return state.buffer;",
        "  }",
        "}",
        ""
      ].join("\n"),
      reports
    );

    expect(reports.join("\n")).toContain("MatchResult");
  });
});
