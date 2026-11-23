import { describe, expect, it } from "vitest";
import transform from "./report-search-strategies.js";
import { runner } from "./test-harness.js";

const run = runner(transform);

const strategy = (...processChunk) => [
  "class TokenStrategy {",
  "  createState() { return { buffer: \"\" }; }",
  ...processChunk,
  "  flush(state) { return state.buffer; }",
  "  matchToString(match) { return match; }",
  "}"
];

describe("search strategy report", () => {
  it("never edits the file", () => {
    const { output } = run(...strategy("  *processChunk(haystack, state) {", "    yield { isMatch: false, content: haystack };", "  }"));

    expect(output).toBeNull();
  });

  it("reports a 3.x strategy's processChunk and the signature to write", () => {
    const { report } = run(...strategy("  *processChunk(haystack, state) {", "    yield { isMatch: false, content: haystack };", "  }"));

    expect(report).toContain("line 1: TokenStrategy is a search strategy");
    expect(report).toContain(
      "processChunk(haystack, state) becomes processChunk(haystack, state, sink: MatchSink): undefined, and is no longer a generator"
    );
  });

  it("reports a text result as a reportText call", () => {
    const { report } = run(...strategy("  *processChunk(haystack, state) {", "    yield { isMatch: false, content: haystack };", "  }"));

    expect(report).toContain("line 4: `yield { isMatch: false, content: haystack }` becomes `sink.reportText(haystack)`");
  });

  it("reports a match as a reportMatch call that stops when it returns false", () => {
    const { report } = run(
      ...strategy("  *processChunk(haystack, state) {", "    yield { isMatch: true, content: haystack, streamIndices: [0, 1] };", "  }")
    );

    expect(report).toContain(
      "line 4: `yield { isMatch: true, content: haystack, streamIndices: [0, 1] }` becomes `if (!sink.reportMatch(haystack, [0, 1])) return;`"
    );
    expect(report).toContain('processChunk("", state, sink)');
  });

  it("reports delegation as a call passing the sink on", () => {
    const { report } = run(...strategy("  *processChunk(haystack, state) {", "    yield* this.inner.processChunk(haystack, state);", "  }"));

    expect(report).toContain(
      "line 4: `yield* this.inner.processChunk(haystack, state)` becomes `this.inner.processChunk(haystack, state, sink)`"
    );
  });

  it("reports any other yield as a call on the sink chosen by the result's isMatch", () => {
    const { report } = run(...strategy("  *processChunk(haystack, state) {", "    yield this.next(haystack);", "  }"));

    expect(report).toContain("line 4: `yield this.next(haystack)` reports its result to `sink.reportText(content)` or `sink.reportMatch(content, streamIndices)`");
  });

  it("points to a finally block when processChunk has none", () => {
    const { report } = run(...strategy("  *processChunk(haystack, state) {", "    yield { isMatch: false, content: haystack };", "  }"));

    expect(report).toContain("finally");
  });

  it("doesn't point to a finally block that processChunk already has", () => {
    const { report } = run(
      ...strategy(
        "  *processChunk(haystack, state) {",
        "    try { yield { isMatch: false, content: haystack }; } finally { state.buffer = \"\"; }",
        "  }"
      )
    );

    expect(report).not.toContain("finally");
  });

  it("names the match type from an implements clause", () => {
    const { report } = run(
      "class TokenStrategy implements SearchStrategy<State, Token> {",
      "  *processChunk(haystack: string, state: State) {}",
      "}"
    );

    expect(report).toContain("sink: MatchSink<Token>");
  });

  it("finds a class that overrides a built-in strategy's processChunk, and its call to super", () => {
    const { report } = run(
      'import { RegexSearchStrategy } from "replace-content-transformer";',
      "class Logged extends RegexSearchStrategy {",
      "  *processChunk(haystack, state) {",
      "    yield* super.processChunk(haystack, state);",
      "  }",
      "}"
    );

    expect(report).toContain("line 2: Logged is a search strategy");
    expect(report).toContain("`yield* super.processChunk(haystack, state)` becomes `super.processChunk(haystack, state, sink)`");
  });

  it("finds an exported strategy class", () => {
    const { report } = run("", ...strategy("  *processChunk(haystack, state) {}").map((line, index) => (index === 0 ? `export ${line}` : line)));

    expect(report).toContain("line 2: TokenStrategy is a search strategy");
  });

  it("finds a class extending a built-in strategy through a namespace import", () => {
    const { report } = run(
      'import * as rct from "replace-content-transformer";',
      "class Logged extends rct.RegexSearchStrategy {",
      "  *processChunk(haystack, state) {",
      "    yield* super.processChunk(haystack, state);",
      "  }",
      "}"
    );

    expect(report).toContain("line 2: Logged is a search strategy");
  });

  it.each([
    ["by name", "const { RegexSearchStrategy } = require(\"replace-content-transformer\");", "RegexSearchStrategy"],
    ["under an alias", "const { RegexSearchStrategy: Regex } = require(\"replace-content-transformer\");", "Regex"],
    ["through a namespace", "const rct = require(\"replace-content-transformer\");", "rct.RegexSearchStrategy"]
  ])("finds a class extending a built-in strategy required %s", (_, required, base) => {
    const { report } = run(required, `class Logged extends ${base} {`, "  *processChunk(haystack, state) {}", "}");

    expect(report).toContain("line 2: Logged is a search strategy");
  });

  it("stays quiet about a class extending a member of a parameter that shadows a namespace import", () => {
    const { reports } = run(
      'import * as rct from "replace-content-transformer";',
      "function f(rct) {",
      "  class Logged extends rct.RegexSearchStrategy {",
      "    *processChunk(haystack, state) {}",
      "  }",
      "}"
    );

    expect(reports).toEqual([]);
  });

  it("stays quiet about a class extending a parameter that shadows a built-in strategy's import", () => {
    const { reports } = run(
      'import { RegexSearchStrategy } from "replace-content-transformer";',
      "function f(RegexSearchStrategy) {",
      "  class Logged extends RegexSearchStrategy {",
      "    *processChunk(haystack, state) {}",
      "  }",
      "}"
    );

    expect(reports).toEqual([]);
  });

  it("finds a strategy written as an object literal", () => {
    const { report } = run(
      "const strategy = {",
      "  createState: () => ({}),",
      "  *processChunk(haystack, state) { yield { isMatch: false, content: haystack }; },",
      "  flush: () => \"\",",
      "  matchToString: (match) => match",
      "};"
    );

    expect(report).toContain("line 1: strategy is a search strategy");
  });

  it.each([
    ["a function declaration", "function* processChunk(haystack, state) {"],
    ["a variable", "const processChunk = function* (haystack, state) {"]
  ])("follows a shorthand processChunk to %s", (_, declaration) => {
    const { report } = run(
      declaration,
      "  yield { isMatch: false, content: haystack };",
      "}",
      "export const strategy = { createState() {}, processChunk, matchToString(match) { return match; } };"
    );

    expect(report).toContain("line 4: strategy is a search strategy");
    expect(report).toContain("line 2: `yield { isMatch: false, content: haystack }` becomes `sink.reportText(haystack)`");
  });

  it("reads the generator that implements processChunk, not the overload signature before it", () => {
    const { report } = run(
      "class OverloadedStrategy {",
      "  createState() {}",
      "  processChunk(haystack: string, state: State): Generator<MatchResult>;",
      "  *processChunk(haystack, state) {",
      "    yield { isMatch: false, content: haystack };",
      "  }",
      "  matchToString(match) { return match; }",
      "}"
    );

    expect(report).toContain("line 5: `yield { isMatch: false, content: haystack }` becomes `sink.reportText(haystack)`");
  });

  it("reports an abstract processChunk whose signature hasn't taken the sink", () => {
    const { report } = run(
      "abstract class BaseStrategy implements SearchStrategy<State> {",
      "  abstract processChunk(haystack: string, state: State): Generator<MatchResult>;",
      "}"
    );

    expect(report).toContain(
      "processChunk(haystack: string, state: State) becomes processChunk(haystack: string, state: State, sink: MatchSink): undefined"
    );
  });

  it("reports a strategy whose processChunk it can't find a function for", () => {
    const { reports } = run(
      'import { processChunk } from "./process-chunk";',
      "export const strategy = { createState() {}, processChunk, matchToString(match) { return match; } };"
    );

    expect(reports).toEqual([
      "line 2: strategy is a search strategy, whose processChunk reports to a MatchSink in 4.0. " +
        "Its processChunk isn't a function this file defines, so check that it takes the sink as its third argument, " +
        "reports each result to it rather than yielding, and returns undefined"
    ]);
  });

  it("stays quiet about a processChunk on a class that isn't a strategy", () => {
    const { reports } = run("class Parser {", "  *processChunk(haystack) { yield haystack; }", "}");

    expect(reports).toEqual([]);
  });

  it("stays quiet about an overloaded strategy already migrated", () => {
    const { reports } = run(
      "class OverloadedStrategy {",
      "  createState() {}",
      "  processChunk(haystack: string, state: State, sink: MatchSink): undefined;",
      "  processChunk(haystack, state, sink) { sink.reportText(haystack); }",
      "  matchToString(match) { return match; }",
      "}"
    );

    expect(reports).toEqual([]);
  });

  it("stays quiet about a strategy already migrated", () => {
    const { reports } = run(
      ...strategy("  processChunk(haystack, state, sink) {", "    sink.reportText(haystack);", "  }")
    );

    expect(reports).toEqual([]);
  });

  it.each([
    ["an optional call", "this.strategy.processChunk?.(chunk, this.state)"],
    ["a computed member", 'this.strategy["processChunk"](chunk, this.state)']
  ])("reports %s that reads a strategy's results", (_, call) => {
    const { report } = run(`for (const result of ${call}) emit(result);`);

    expect(report).toContain(`line 1: \`${call}\` no longer returns results`);
  });

  it("reports code that reads a strategy's results, such as a custom engine", () => {
    const { report } = run("for (const result of this.strategy.processChunk(chunk, this.state)) emit(result);");

    expect(report).toContain(
      "line 1: `this.strategy.processChunk(chunk, this.state)` no longer returns results; pass a MatchSink as its third argument"
    );
  });
});
