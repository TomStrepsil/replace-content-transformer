import { describe, expect, it } from "vitest";
import jscodeshift from "jscodeshift";

const tsx = jscodeshift.withParser("tsx");
import transform from "./flush-call-site-to-drain.js";

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

describe("flush-call-site report", () => {
  it("never edits the file", () => {
    const { output } = runTransform(
      ["const tail = strategy.flush(state);", "if (tail) enqueue(tail);", ""].join("\n")
    );

    expect(output).toBeNull();
  });

  it("writes the drain loop out for the names in use", () => {
    const { report } = runTransform(
      ["const tail = strategy.flush(state);", "if (tail) enqueue(tail);", ""].join("\n")
    );

    expect(report).toContain("fixture.ts:1");
    expect(report).toContain("for (const result of strategy.flush(state)) {");
    expect(report).toContain("const tail = result.isMatch");
    expect(report).toContain("? strategy.matchToString(result.content)");
    expect(report).toContain("the statements that used `tail`, unchanged");
  });

  it("names the decision the loop does not make", () => {
    const { report } = runTransform(
      ["const tail = strategy.flush(state);", "if (tail) enqueue(tail);", ""].join("\n")
    );

    expect(report).toContain("A match settling here is the point of the change");
  });

  it("uses the receiver as written", () => {
    const { report } = runTransform(
      [
        "const tail = this.searchStrategy.flush(this.state);",
        "if (tail) enqueue(tail);",
        ""
      ].join("\n")
    );

    expect(report).toContain(
      "for (const result of this.searchStrategy.flush(this.state)) {"
    );
    expect(report).toContain("? this.searchStrategy.matchToString(result.content)");
  });

  it("reports a result that is returned as needing a hand migration", () => {
    const { report } = runTransform(
      ["function f() {", "  return strategy.flush(state);", "}", ""].join("\n")
    );

    expect(report).toContain("needs rethinking by hand");
  });

  it("reports a result passed straight as an argument", () => {
    const { report } = runTransform(
      ["enqueue(strategy.flush(state));", ""].join("\n")
    );

    expect(report).toContain("needs rethinking by hand");
  });

  it("reports a declaration that declares more than one variable", () => {
    const { report } = runTransform(
      [
        "const tail = strategy.flush(state), metric = createMetric();",
        "if (tail) enqueue(tail);",
        ""
      ].join("\n")
    );

    expect(report).toContain("fixture.ts:1");
  });

  it("says nothing about an already-migrated drain loop", () => {
    const { report } = runTransform(
      [
        "for (const result of strategy.flush(state)) {",
        "  enqueue(result.content);",
        "}",
        ""
      ].join("\n")
    );

    expect(report).toBe("");
  });

  it("says nothing about a flush that is not a search strategy's", () => {
    const { report } = runTransform(
      ["const tail = writer.flush();", "if (tail) out(tail);", ""].join("\n")
    );

    expect(report).toBe("");
  });
});
