import { describe, expect, it } from "vitest";
import { withParser } from "jscodeshift";

const tsx = withParser("tsx");
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

  describe("which methods are flush implementations", () => {
    const reportFor = (header) =>
      runTransform(strategy(header, "    return state.buffer;", "  }")).report;

    it("matches a quoted method name", () => {
      expect(reportFor('  "flush"(state: State): string {')).toContain("fixture.ts:2");
    });

    it.each([
      ["a getter", "  get flush(): string {"],
      ["a setter", "  set flush(value: string) {"],
      ["a static method", "  static flush(state: State): string {"],
      ["a computed method", "  [flush](state: State): string {"],
      ["a computed string method", '  ["flush"](state: State): string {'],
      ["a private method", "  #flush(state: State): string {"],
      ["a method with another name", "  drain(state: State): string {"]
    ])("says nothing about %s", (_, header) => {
      expect(reportFor(header)).toBe("");
    });
  });

  describe("what each return becomes", () => {
    const reportFor = (...body) =>
      runTransform(
        strategy("  flush(state: State): string {", ...body, "  }")
      ).report;

    it("says nothing about a bare return", () => {
      expect(reportFor("    if (!state.buffer) return;", "    return state.buffer;")).not.toContain(
        "line 3"
      );
    });

    it("binds a conditional before guarding it", () => {
      expect(reportFor("    return state.cached ? state.cached : state.buffer;")).toContain(
        "const flushed = state.cached ? state.cached : state.buffer;"
      );
    });

    it("binds a logical expression before guarding it", () => {
      expect(reportFor("    return state.cached ?? state.buffer;")).toContain(
        "const flushed = state.cached ?? state.buffer;"
      );
    });

    it("does not treat a computed flush call as delegation", () => {
      const report = reportFor("    return this.inner[flush](state);");

      expect(report).not.toContain("yield*");
      expect(report).toContain("const flushed = this.inner[flush](state);");
    });

    it("does not treat a non-flush call as delegation", () => {
      expect(reportFor("    return this.inner.drain(state);")).not.toContain("yield*");
    });

    it("does not treat a bare flush() call as delegation", () => {
      expect(reportFor("    return flush(state);")).not.toContain("yield*");
    });

    it.each([
      ["a function expression", "function () { return 1; }"],
      ["an arrow function", "() => { return 1; }"],
      ["an object method", "{ get() { return 1; } }"],
      ["a class method", "class { get() { return 1; } }"]
    ])("ignores returns inside %s", (_, nested) => {
      const report = reportFor(`    const value = ${nested};`, "    return state.buffer;");

      expect(report).not.toContain("line 3");
      expect(report).toContain("line 4");
    });

    it("ends the generator after a return that is not last", () => {
      const report = reportFor(
        "    if (state.done) return state.buffer;",
        "    return state.other;"
      );

      expect(report).toContain("line 3: `return state.buffer` becomes");
      expect(report).toContain("then `return;` to end the generator");
      expect(report).not.toMatch(/line 4:[^\n]*then `return;`/);
    });
  });

  it("reports an unannotated flush, as plain JavaScript writes it", () => {
    const { report } = runTransform(
      [
        "class S extends StringBufferStrategyBase {",
        "  flush(state) {",
        "    return state.buffer;",
        "  }",
        "}",
        ""
      ].join("\n")
    );

    expect(report).toContain("fixture.ts:2");
    expect(report).toContain("Generator<MatchResult<string>, void, undefined>");
  });

  describe("the signature written", () => {
    const signatureFor = (parameters) =>
      runTransform(
        strategy(`  flush(${parameters}): string {`, "    return state.buffer;", "  }")
      ).report;

    it("takes no parameters", () => {
      expect(signatureFor("")).toContain("becomes *flush(): Generator<");
    });

    it("keeps every parameter in order", () => {
      expect(signatureFor("state: State, final: boolean")).toContain(
        "becomes *flush(state: State, final: boolean): Generator<"
      );
    });
  });

  describe("which classes are strategies", () => {
    const reportFor = (heading) =>
      runTransform(
        [heading, "  flush(state: State): string {", "    return state.buffer;", "  }", "}", ""].join("\n")
      ).report;

    it("finds a namespace-qualified interface", () => {
      expect(reportFor("class S implements rct.SearchStrategy<State, Foo> {")).toContain(
        "MatchResult<Foo>"
      );
    });

    it("finds a base class with no type arguments", () => {
      expect(reportFor("class S extends StringBufferStrategyBase {")).toContain(
        "MatchResult<string>"
      );
    });

    it("says nothing about an interface that only resembles a strategy", () => {
      expect(reportFor("class S implements Flushable<State> {")).toBe("");
    });

    it("says nothing about a class that implements nothing and extends nothing", () => {
      expect(reportFor("class S {")).toBe("");
    });

    it("says nothing about a class extending something that is not a strategy", () => {
      expect(reportFor("class S extends Cache {")).toBe("");
    });
  });

  it("does not ask for the import when only a non-string flush was found", () => {
    const { report } = runTransform(
      strategy("  flush(state: State): number {", "    return 1;", "  }")
    );

    expect(report).not.toContain("add a type import");
  });

  describe("aliased imports", () => {
    const flushBody = [
      "  flush(state: State): string {",
      "    return state.buffer;",
      "  }",
      "}",
      ""
    ];

    it("finds a class implementing an aliased SearchStrategy", () => {
      const { report } = runTransform(
        [
          'import type { SearchStrategy as Strategy } from "replace-content-transformer";',
          "class S implements Strategy<State, RegExpExecArray> {",
          ...flushBody
        ].join("\n")
      );

      expect(report).toContain("fixture.ts:3");
      expect(report).toContain("Generator<MatchResult<RegExpExecArray>, void, undefined>");
    });

    it("finds a class implementing a SearchStrategy imported under a string-literal name", () => {
      const { report } = runTransform(
        [
          'import type { "SearchStrategy" as Strategy } from "replace-content-transformer";',
          "class S implements Strategy<State, RegExpExecArray> {",
          ...flushBody
        ].join("\n")
      );

      expect(report).toContain("Generator<MatchResult<RegExpExecArray>, void, undefined>");
    });

    it("finds an aliased SearchStrategy imported with an inline type specifier", () => {
      const { report } = runTransform(
        [
          'import { type SearchStrategy as Strategy } from "replace-content-transformer";',
          "class S implements Strategy<State> {",
          ...flushBody
        ].join("\n")
      );

      expect(report).toContain("fixture.ts:3");
      expect(report).toContain("MatchResult<string>");
    });

    it("finds a class extending an aliased StringBufferStrategyBase", () => {
      const { report } = runTransform(
        [
          'import { StringBufferStrategyBase as Base } from "replace-content-transformer";',
          "class S extends Base<RegExpExecArray> {",
          ...flushBody
        ].join("\n")
      );

      expect(report).toContain("fixture.ts:3");
      expect(report).toContain("MatchResult<RegExpExecArray>");
    });

    it("stays quiet about an alias of something that is not a strategy", () => {
      const { report } = runTransform(
        [
          'import { Cache as Strategy } from "somewhere";',
          "class S implements Strategy<State> {",
          ...flushBody
        ].join("\n")
      );

      expect(report).toBe("");
    });

    it("stays quiet about an aliased SearchStrategy from another package", () => {
      const { report } = runTransform(
        [
          'import type { SearchStrategy as Strategy } from "another-library";',
          "class S implements Strategy<State> {",
          ...flushBody
        ].join("\n")
      );

      expect(report).toBe("");
    });

    it.each([
      ["an implemented", 'import type { SearchStrategy } from "another-library";', "implements SearchStrategy<State>"],
      ["an extended", 'import { StringBufferStrategyBase } from "another-library";', "extends StringBufferStrategyBase<string>"],
      ["a default-imported", 'import SearchStrategy from "another-library";', "implements SearchStrategy<State>"]
    ])("stays quiet about %s strategy name from another package", (_, importLine, heritage) => {
      const { report } = runTransform([importLine, `class S ${heritage} {`, ...flushBody].join("\n"));

      expect(report).toBe("");
    });

    it("does not print a MatchResult alias from another package", () => {
      const { report } = runTransform(
        [
          'import type { MatchResult as Result } from "another-library";',
          'import type { SearchStrategy } from "replace-content-transformer";',
          "class S implements SearchStrategy<State> {",
          ...flushBody
        ].join("\n")
      );

      expect(report).toContain("Generator<MatchResult<string>, void, undefined>");
      expect(report).toContain("add a type import for MatchResult");
    });

    it("resolves an alias imported from a package subpath", () => {
      const { report } = runTransform(
        [
          'import type { SearchStrategy as Strategy } from "replace-content-transformer/web";',
          "class S implements Strategy<State> {",
          ...flushBody
        ].join("\n")
      );

      expect(report).toContain("MatchResult<string>");
    });

    it("does not ask for a MatchResult import that is already aliased", () => {
      const { report } = runTransform(
        [
          'import type { MatchResult as Result, SearchStrategy as Strategy } from "replace-content-transformer";',
          "class S implements Strategy<State> {",
          ...flushBody
        ].join("\n")
      );

      expect(report).toContain("Generator<Result<string>, void, undefined>");
      expect(report).not.toContain("add a type import");
    });
  });
});
