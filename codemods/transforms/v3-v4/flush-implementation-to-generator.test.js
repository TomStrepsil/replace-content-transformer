import { describe, expect, it } from "vitest";
import jscodeshift from "jscodeshift";

const tsx = jscodeshift.withParser("tsx");
import transform from "./flush-implementation-to-generator.js";

function runTransform(source) {
  const reports = [];
  const output = transform(
    { path: "fixture.ts", source },
    {
      jscodeshift: tsx,
      j: tsx,
      stats: () => undefined,
      report: (message) => reports.push(message)
    },
    {}
  );
  return { output, report: reports.join("\n") };
}

const strategy = (...body) =>
  ["class S implements SearchStrategy<State, string> {", ...body, "}", ""].join(
    "\n"
  );

describe("flush-implementation report", () => {
  it("never edits the file", () => {
    const { output } = runTransform(
      strategy("  flush(state: State): string {", "    return state.buffer;", "  }")
    );

    expect(output).toBeNull();
  });

  it("reports the signature to write", () => {
    const { report } = runTransform(
      strategy(
        "  flush(state: State): string {",
        "    const flushed = state.buffer;",
        "    return flushed;",
        "  }"
      )
    );

    expect(report).toContain("fixture.ts:2");
    expect(report).toContain(
      "becomes *flush(state: State): Generator<MatchResult<string>, void, undefined>"
    );
    expect(report).toContain(
      "`return flushed` becomes `if (flushed) yield { isMatch: false, content: flushed }`"
    );
  });

  it("reports delegation as yield*", () => {
    const { report } = runTransform(
      strategy(
        "  flush(state: State): string {",
        "    return this.inner.flush(state);",
        "  }"
      )
    );

    expect(report).toContain("becomes `yield* this.inner.flush(state)`");
  });

  it("reports a composed result as needing each part yielded", () => {
    const { report } = runTransform(
      strategy(
        "  flush(state: State): string {",
        "    return state.buffer + this.inner.flush(state);",
        "  }"
      )
    );

    expect(report).toContain("composes its result; yield each part in turn");
  });

  it("notes the terminator a return outside tail position needs", () => {
    const { report } = runTransform(
      strategy(
        "  flush(state: State): string {",
        "    if (state.cached) return state.cached;",
        "    return state.buffer;",
        "  }"
      )
    );

    expect(report).toContain("then `return;` to end the generator");
    expect(report.match(/then `return;`/g)).toHaveLength(1);
  });

  it("binds a non-identifier return before guarding it", () => {
    const { report } = runTransform(
      strategy("  flush(state: State): string {", "    return state.buffer;", "  }")
    );

    expect(report).toContain(
      "const flushed = state.buffer; if (flushed) yield { isMatch: false, content: flushed };"
    );
  });

  it("takes the match type from the implemented interface", () => {
    const { report } = runTransform(
      [
        "class S implements SearchStrategy<State, RegExpExecArray> {",
        "  flush(state: State): string {",
        "    return state.buffer;",
        "  }",
        "}",
        ""
      ].join("\n")
    );

    expect(report).toContain("Generator<MatchResult<RegExpExecArray>, void, undefined>");
  });

  it("defaults the match type to string when the interface names only its state", () => {
    const { report } = runTransform(
      [
        "class S implements SearchStrategy<State> {",
        "  flush(state: State): string {",
        "    return state.buffer;",
        "  }",
        "}",
        ""
      ].join("\n")
    );

    expect(report).toContain("Generator<MatchResult<string>, void, undefined>");
  });

  it("takes the sole type argument of a base class as the match type", () => {
    const { report } = runTransform(
      [
        "class S extends StringBufferStrategyBase<RegExpExecArray> {",
        "  flush(state: State): string {",
        "    return state.buffer;",
        "  }",
        "}",
        ""
      ].join("\n")
    );

    expect(report).toContain("Generator<MatchResult<RegExpExecArray>, void, undefined>");
  });

  it("asks for the MatchResult import the new signature needs", () => {
    const { report } = runTransform(
      strategy("  flush(state: State): string {", "    return state.buffer;", "  }")
    );

    expect(report).toContain("add a type import for MatchResult");
  });

  it("stays quiet about an import that is already there", () => {
    const { report } = runTransform(
      [
        'import type { MatchResult } from "replace-content-transformer";',
        "class S implements SearchStrategy<State, string> {",
        "  flush(state: State): string {",
        "    return state.buffer;",
        "  }",
        "}",
        ""
      ].join("\n")
    );

    expect(report).not.toContain("add a type import");
  });

  it("says nothing about a flush that is not a search strategy's", () => {
    const { report } = runTransform(
      ["class Cache {", "  flush(): string {", "    return this.buffered;", "  }", "}", ""].join("\n")
    );

    expect(report).toBe("");
  });

  it("says nothing about an already-migrated generator", () => {
    const { report } = runTransform(
      strategy(
        "  *flush(state: State): Generator<MatchResult<string>, void, undefined> {",
        "    yield { isMatch: false, content: state.buffer };",
        "  }"
      )
    );

    expect(report).toBe("");
  });

  it("says nothing about a subclass that inherits flush", () => {
    const { report } = runTransform(
      strategy("  createState() {", "    return {};", "  }")
    );

    expect(report).toBe("");
  });

  it("ignores returns inside nested functions", () => {
    const { report } = runTransform(
      strategy(
        "  flush(state: State): string {",
        "    const parts = state.items.map(function (item) {",
        "      return item.text;",
        "    });",
        '    return parts.join("");',
        "  }"
      )
    );

    expect(report).not.toContain("item.text");
    expect(report).toContain('parts.join("")');
  });

  it("reports a non-string return type as possibly already migrated", () => {
    const { report } = runTransform(
      strategy("  flush(state: State): number {", "    return 1;", "  }")
    );

    expect(report).toContain("check whether it is already migrated");
  });
  it("does not guess the match type of a class extending a concrete strategy", () => {
    const { report } = runTransform(
      [
        "class Custom extends RegexSearchStrategy {",
        "  flush(state: State): string {",
        "    return state.buffer;",
        "  }",
        "}",
        ""
      ].join("\n")
    );

    expect(report).toContain("fixture.ts:2");
    expect(report).not.toContain("MatchResult<string>");
    expect(report).toContain("inherited from RegexSearchStrategy");
  });
});
