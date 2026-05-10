import { describe, expect, it } from "vitest";
import jscodeshift from "jscodeshift";
import transform from "./processor-to-engine.js";

function runTransform(source) {
  const j = jscodeshift.withParser("tsx");
  return transform(
    {
      path: "fixture.ts",
      source,
    },
    {
      jscodeshift: j,
      j,
      stats: () => undefined,
      report: () => undefined,
    },
    {}
  );
}

describe("processor-to-engine codemod", () => {
  describe("new expression renames", () => {
    it("renames FunctionReplacementProcessor to SyncReplacementTransformEngine", () => {
      const input = [
        "const engine = new FunctionReplacementProcessor({",
        "  searchStrategy,",
        "  replacement: (match, { matchIndex }) => `${matchIndex}: ${match}`",
        "});",
        "",
      ].join("\n");

      const output = runTransform(input);

      expect(output).not.toBeNull();
      expect(output).toContain("SyncReplacementTransformEngine");
      expect(output).not.toContain("FunctionReplacementProcessor");
    });

    it("renames StaticReplacementProcessor to SyncReplacementTransformEngine", () => {
      const input = [
        "const engine = new StaticReplacementProcessor({",
        "  searchStrategy,",
        "  replacement: 'hello'",
        "});",
        "",
      ].join("\n");

      const output = runTransform(input);

      expect(output).not.toBeNull();
      expect(output).toContain("SyncReplacementTransformEngine");
      expect(output).not.toContain("StaticReplacementProcessor");
    });

    it("renames IterableFunctionReplacementProcessor to SyncReplacementTransformEngine", () => {
      const input = [
        "const engine = new IterableFunctionReplacementProcessor({",
        "  searchStrategy,",
        "  replacement: (match, { matchIndex }) => [match, `(${matchIndex})`]",
        "});",
        "",
      ].join("\n");

      const output = runTransform(input);

      expect(output).not.toBeNull();
      expect(output).toContain("SyncReplacementTransformEngine");
      expect(output).not.toContain("IterableFunctionReplacementProcessor");
    });

    it("renames AsyncFunctionReplacementProcessor to AsyncSerialReplacementTransformEngine", () => {
      const input = [
        "const engine = new AsyncFunctionReplacementProcessor({",
        "  searchStrategy,",
        "  replacement: async (match, { matchIndex }) => `${matchIndex}: ${match}`",
        "});",
        "",
      ].join("\n");

      const output = runTransform(input);

      expect(output).not.toBeNull();
      expect(output).toContain("AsyncSerialReplacementTransformEngine");
      expect(output).not.toContain("AsyncFunctionReplacementProcessor");
    });

    it("renames AsyncIterableFunctionReplacementProcessor to AsyncSerialReplacementTransformEngine", () => {
      const input = [
        "const engine = new AsyncIterableFunctionReplacementProcessor({",
        "  searchStrategy,",
        "  replacement: async function* (match) { yield match; }",
        "});",
        "",
      ].join("\n");

      const output = runTransform(input);

      expect(output).not.toBeNull();
      expect(output).toContain("AsyncSerialReplacementTransformEngine");
      expect(output).not.toContain("AsyncIterableFunctionReplacementProcessor");
    });
  });

  describe("import specifier renames", () => {
    it("renames a processor import specifier to the engine name", () => {
      const input = [
        "import { FunctionReplacementProcessor } from 'replace-content-transformer';",
        "",
      ].join("\n");

      const output = runTransform(input);

      expect(output).not.toBeNull();
      expect(output).toContain("SyncReplacementTransformEngine");
      expect(output).not.toContain("FunctionReplacementProcessor");
    });

    it("deduplicates specifiers when multiple processors map to the same engine", () => {
      const input = [
        "import {",
        "  FunctionReplacementProcessor,",
        "  StaticReplacementProcessor",
        "} from 'replace-content-transformer';",
        "",
      ].join("\n");

      const output = runTransform(input);

      expect(output).not.toBeNull();
      const matches = output.match(/SyncReplacementTransformEngine/g);
      expect(matches).toHaveLength(1);
    });

    it("renames both sync and async processor imports independently", () => {
      const input = [
        "import {",
        "  FunctionReplacementProcessor,",
        "  AsyncFunctionReplacementProcessor",
        "} from 'replace-content-transformer';",
        "",
      ].join("\n");

      const output = runTransform(input);

      expect(output).not.toBeNull();
      expect(output).toContain("SyncReplacementTransformEngine");
      expect(output).toContain("AsyncSerialReplacementTransformEngine");
    });

    it("preserves aliased imports unchanged (manual migration required)", () => {
      const input = [
        "import { FunctionReplacementProcessor as FRP } from 'replace-content-transformer';",
        "const engine = new FRP({ searchStrategy, replacement: (match) => match });",
        "",
      ].join("\n");

      const output = runTransform(input);

      // The imported name is renamed but the local alias and its usages are left as-is
      expect(output).toContain("SyncReplacementTransformEngine as FRP");
      expect(output).toContain("new FRP(");
    });
  });

  describe("stopReplacingSignal migration", () => {
    it("moves inline stopReplacingSignal from adapter 2nd arg into engine options", () => {
      const input = [
        "const transformer = new ReplaceContentTransformer(",
        "  new FunctionReplacementProcessor({ searchStrategy, replacement: (match) => match }),",
        "  controller.signal",
        ");",
        "",
      ].join("\n");

      const output = runTransform(input);

      expect(output).not.toBeNull();
      expect(output).toContain("stopReplacingSignal: controller.signal");
      expect(output).not.toContain(", controller.signal");
    });

    it("handles all four adapter types", () => {
      for (const adapter of [
        "ReplaceContentTransformer",
        "AsyncReplaceContentTransformer",
        "ReplaceContentTransform",
        "AsyncReplaceContentTransform",
      ]) {
        const input = [
          `const t = new ${adapter}(`,
          "  new FunctionReplacementProcessor({ searchStrategy, replacement: (match) => match }),",
          "  signal",
          ");",
          "",
        ].join("\n");

        const output = runTransform(input);

        expect(output).toContain("stopReplacingSignal: signal");
        expect(output).not.toContain(`, signal`);
      }
    });

    it("does not move stopReplacingSignal when the engine is a variable reference", () => {
      const input = [
        "const engine = new FunctionReplacementProcessor({ searchStrategy, replacement: (match) => match });",
        "const transformer = new ReplaceContentTransformer(engine, signal);",
        "",
      ].join("\n");

      const output = runTransform(input);

      // Processor rename still fires; signal move does not (engine is a variable, not inline)
      expect(output).toContain("SyncReplacementTransformEngine");
      expect(output).toContain("new ReplaceContentTransformer(engine, signal)");
      expect(output).not.toContain("stopReplacingSignal");
    });
  });

  describe("adapter type parameter removal", () => {
    it("strips Promise<string> type parameter from ReplaceContentTransformer", () => {
      const input = [
        "const t = new ReplaceContentTransformer<Promise<string>>(engine);",
        "",
      ].join("\n");

      const output = runTransform(input);

      expect(output).not.toBeNull();
      expect(output).toContain("new ReplaceContentTransformer(engine)");
      expect(output).not.toContain("<Promise<string>>");
    });

    it("strips type parameters from all adapter types", () => {
      for (const adapter of [
        "ReplaceContentTransformer",
        "AsyncReplaceContentTransformer",
        "ReplaceContentTransform",
        "AsyncReplaceContentTransform",
      ]) {
        const input = `const t = new ${adapter}<Promise<string>>(engine);\n`;
        const output = runTransform(input);
        expect(output).not.toContain("<Promise<string>>");
      }
    });
  });

  describe("no-op cases", () => {
    it("returns null when the file contains no processors or affected adapters", () => {
      const input = [
        "const engine = new SyncReplacementTransformEngine({ searchStrategy, replacement: (match) => match });",
        "const transformer = new ReplaceContentTransformer(engine);",
        "",
      ].join("\n");

      expect(runTransform(input)).toBeNull();
    });

    it("handles a file with both sync and async processors", () => {
      const input = [
        "const sync = new FunctionReplacementProcessor({ searchStrategy, replacement: (match) => match });",
        "const async_ = new AsyncFunctionReplacementProcessor({ searchStrategy, replacement: async (match) => match });",
        "",
      ].join("\n");

      const output = runTransform(input);

      expect(output).toContain("SyncReplacementTransformEngine");
      expect(output).toContain("AsyncSerialReplacementTransformEngine");
      expect(output).not.toContain("FunctionReplacementProcessor");
      expect(output).not.toContain("AsyncFunctionReplacementProcessor");
    });
  });
});
