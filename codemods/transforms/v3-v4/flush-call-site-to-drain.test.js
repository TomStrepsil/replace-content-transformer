import { describe, expect, it } from "vitest";
import jscodeshift from "jscodeshift";

const tsx = jscodeshift.withParser("tsx");
import transform from "./flush-call-site-to-drain.js";

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

describe("flush-call-site-to-drain codemod", () => {
  it("wraps the simple declaration-and-use pair in a drain loop", () => {
    const output = runTransform(
      [
        "function end() {",
        "  const tail = strategy.flush(state);",
        "  if (tail) sink.enqueue(tail);",
        "}",
        ""
      ].join("\n")
    );

    expect(output).toContain("for (const result of strategy.flush(state))");
    expect(output).toContain("result.isMatch");
    expect(output).toContain("strategy.matchToString(result.content)");
    expect(output).toContain("if (tail) sink.enqueue(tail)");
    expect(output).toContain("TODO(v4)");
  });

  it("preserves the original bytes by stringifying every result", () => {
    const output = runTransform(
      [
        "function end() {",
        "  const tail = this._searchStrategy.flush(this._state);",
        "  if (tail) this._sink.enqueue(tail);",
        "}",
        ""
      ].join("\n")
    );

    expect(output).toContain(
      "this._searchStrategy.matchToString(result.content)"
    );
    expect(output).toContain("result.content");
  });

  it("rewrites a call site inside try/finally", () => {
    const output = runTransform(
      [
        "function end() {",
        "  try {",
        "    const tail = strategy.flush(state);",
        "    sink.enqueue(tail);",
        "  } finally {",
        "    done();",
        "  }",
        "}",
        ""
      ].join("\n")
    );

    expect(output).toContain("for (const result of strategy.flush(state))");
    expect(output).toContain("done()");
  });

  it("leaves an already-migrated drain loop untouched", () => {
    const output = runTransform(
      [
        "function end() {",
        "  for (const result of strategy.flush(state)) {",
        "    sink.enqueue(result.content);",
        "  }",
        "}",
        ""
      ].join("\n")
    );

    expect(output).toBeNull();
  });

  it("reports rather than mangles a result that is returned", () => {
    const reports = [];
    const output = runTransform(
      ["function end() {", "  return strategy.flush(state) + tail;", "}", ""].join("\n"),
      reports
    );

    expect(output).toBeNull();
    expect(reports[0]).toContain("flows somewhere this codemod will not rewrite");
  });

  it("reports rather than mangles a result passed straight as an argument", () => {
    const reports = [];
    const output = runTransform(
      ["function end() {", "  sink.enqueue(strategy.flush(state));", "}", ""].join("\n"),
      reports
    );

    expect(output).toBeNull();
    expect(reports[0]).toContain("flows somewhere this codemod will not rewrite");
  });
  it("leaves a flush() that is not a search strategy's alone", () => {
    const reports = [];
    const output = runTransform(
      [
        "const tail = writer.flush();",
        "if (tail) out(tail);",
        ""
      ].join("\n"),
      reports
    );

    expect(output).toBeNull();
    expect(reports.join("\n")).toContain("not identifiably a SearchStrategy");
  });

  it("does not absorb a following statement that ignores the tail", () => {
    const output = runTransform(
      [
        "const tail = strategy.flush(state);",
        "logOnce();",
        "if (tail) enqueue(tail);",
        ""
      ].join("\n")
    );

    expect(output).toBeNull();
  });

  it("does not shadow a binding the consumed statements rely on", () => {
    const output = runTransform(
      [
        "const result = prefix;",
        "const tail = strategy.flush(state);",
        "if (tail) enqueue(result + tail);",
        ""
      ].join("\n")
    );

    expect(output).toContain("const result = prefix;");
    expect(output).toMatch(/for \(const (result\d+|[a-z]+Result) of/);
    expect(output).toContain("enqueue(result + tail)");
  });
});
