import jscodeshift from "jscodeshift";

const j = jscodeshift.withParser("tsx");

export function runner(transform) {
  return (...lines) => {
    const reports = [];
    const output = transform(
      { path: "fixture.ts", source: lines.join("\n") },
      { jscodeshift: j, j, stats: () => undefined, report: (message) => reports.push(message) },
      {}
    );
    return { output, reports, report: reports.join("\n") };
  };
}
