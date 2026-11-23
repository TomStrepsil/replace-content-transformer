import { describe, expect, it } from "vitest";
import jscodeshift from "jscodeshift";
import transform from "./rename-exports.js";

const j = jscodeshift.withParser("tsx");

function run(...lines) {
  const reports = [];
  const output = transform(
    { path: "fixture.ts", source: lines.join("\n") },
    { jscodeshift: j, j, stats: () => undefined, report: (message) => reports.push(message) },
    {}
  );
  return { output, reports };
}

describe("rename-exports codemod", () => {
  describe("engine renames", () => {
    it("renames SyncReplacementTransformEngine to SerialTransformEngine in the import and its uses", () => {
      const { output } = run(
        'import { SyncReplacementTransformEngine } from "replace-content-transformer";',
        "const engine = new SyncReplacementTransformEngine({ searchStrategy, replacement });"
      );

      expect(output).toBe(
        [
          'import { SerialTransformEngine } from "replace-content-transformer";',
          "const engine = new SerialTransformEngine({ searchStrategy, replacement });"
        ].join("\n")
      );
    });

    it.each([
      ["AsyncSerialReplacementTransformEngine", "SerialTransformEngine"],
      ["AsyncLookaheadTransformEngine", "LookaheadTransformEngine"]
    ])("renames %s to %s", (before, after) => {
      const { output } = run(
        `import { ${before} } from "replace-content-transformer";`,
        `new ${before}({ searchStrategy, replacement });`
      );

      expect(output).toBe(
        [`import { ${after} } from "replace-content-transformer";`, `new ${after}({ searchStrategy, replacement });`].join("\n")
      );
    });

    it.each([
      ["AsyncSerialReplacementTransformEngineOptions", "SerialTransformEngineOptions"],
      ["SyncTransformEngine", "TransformEngine"],
      ["AsyncTransformEngine", "TransformEngine"],
      ["AsyncLookaheadTransformEngineOptions", "LookaheadTransformEngineOptions"]
    ])("renames the type %s to %s", (before, after) => {
      const { output } = run(
        `import type { ${before} } from "replace-content-transformer";`,
        `let value: ${before};`
      );

      expect(output).toBe(
        [`import type { ${after} } from "replace-content-transformer";`, `let value: ${after};`].join("\n")
      );
    });
  });

  describe("replacement function types", () => {
    it("gives SyncReplacementFn's return type explicitly, so the engine's calls stay synchronous", () => {
      const { output } = run(
        'import type { SyncReplacementFn } from "replace-content-transformer";',
        "const replace: SyncReplacementFn<string> = (match) => match;"
      );

      expect(output).toBe(
        [
          'import type { SerialReplacementFn } from "replace-content-transformer";',
          "const replace: SerialReplacementFn<string, string | Iterable<string>> = (match) => match;"
        ].join("\n")
      );
    });

    it("renames AsyncSerialReplacementFn to SerialReplacementFn, keeping its default return type", () => {
      const { output } = run(
        'import type { AsyncSerialReplacementFn } from "replace-content-transformer";',
        "const replace: AsyncSerialReplacementFn<string> = async (match) => match;"
      );

      expect(output).toBe(
        [
          'import type { SerialReplacementFn } from "replace-content-transformer";',
          "const replace: SerialReplacementFn<string> = async (match) => match;"
        ].join("\n")
      );
    });

    it("renames ReplacementFn to LookaheadReplacementFn", () => {
      const { output } = run(
        'import type { ReplacementFn } from "replace-content-transformer";',
        "const replace: ReplacementFn<string> = async (match) => fetchFor(match);"
      );

      expect(output).toBe(
        [
          'import type { LookaheadReplacementFn } from "replace-content-transformer";',
          "const replace: LookaheadReplacementFn<string> = async (match) => fetchFor(match);"
        ].join("\n")
      );
    });
  });

  describe("sync engine type arguments", () => {
    it("adds the replacement type argument to the sync engine's type, so write() and end() stay void", () => {
      const { output } = run(
        'import { SyncReplacementTransformEngine } from "replace-content-transformer";',
        "let engine: SyncReplacementTransformEngine<State, string>;"
      );

      expect(output).toBe(
        [
          'import { SerialTransformEngine, type SerialReplacementFn } from "replace-content-transformer";',
          "let engine: SerialTransformEngine<State, string, string | SerialReplacementFn<string, string | Iterable<string>>>;"
        ].join("\n")
      );
    });

    it("fills in the default match type when only the state type is given", () => {
      const { output } = run(
        'import { SyncReplacementTransformEngineOptions, SerialReplacementFn } from "replace-content-transformer";',
        "let options: SyncReplacementTransformEngineOptions<State>;"
      );

      expect(output).toContain(
        "let options: SerialTransformEngineOptions<State, string, string | SerialReplacementFn<string, string | Iterable<string>>>;"
      );
    });

    it("adds SerialReplacementFn to a type-only import of the sync engine's options", () => {
      const { output } = run(
        'import type { SyncReplacementTransformEngineOptions } from "replace-content-transformer";',
        "let options: SyncReplacementTransformEngineOptions<State, Match>;"
      );

      expect(output).toBe(
        [
          'import type { SerialTransformEngineOptions, SerialReplacementFn } from "replace-content-transformer";',
          "let options: SerialTransformEngineOptions<State, Match, string | SerialReplacementFn<Match, string | Iterable<string>>>;"
        ].join("\n")
      );
    });

    it("adds the replacement type argument to a constructor given explicit type arguments", () => {
      const { output } = run(
        'import { SyncReplacementTransformEngine, type SerialReplacementFn } from "replace-content-transformer";',
        "new SyncReplacementTransformEngine<State, Match>(options);"
      );

      expect(output).toContain(
        "new SerialTransformEngine<State, Match, string | SerialReplacementFn<Match, string | Iterable<string>>>(options);"
      );
    });

    it("adds the replacement type argument to a class extending the sync engine", () => {
      const { output } = run(
        'import { SyncReplacementTransformEngine, type SerialReplacementFn } from "replace-content-transformer";',
        "class Engine extends SyncReplacementTransformEngine<State> {}"
      );

      expect(output).toContain(
        "class Engine extends SerialTransformEngine<State, string, string | SerialReplacementFn<string, string | Iterable<string>>> {}"
      );
    });

    it("leaves a constructor without type arguments to infer them", () => {
      const { output } = run(
        'import { SyncReplacementTransformEngine } from "replace-content-transformer";',
        "new SyncReplacementTransformEngine({ searchStrategy, replacement });"
      );

      expect(output).toBe(
        [
          'import { SerialTransformEngine } from "replace-content-transformer";',
          "new SerialTransformEngine({ searchStrategy, replacement });"
        ].join("\n")
      );
    });
  });

  describe("adapters", () => {
    it.each(["ReplaceContentTransformer", "AsyncReplaceContentTransformer"])(
      "renames the web adapter %s to ReplaceContentTextTransformer",
      (before) => {
        const { output } = run(
          `import { ${before} } from "replace-content-transformer/web";`,
          `stream.pipeThrough(new ${before}(engine));`
        );

        expect(output).toBe(
          [
            'import { ReplaceContentTextTransformer } from "replace-content-transformer/web";',
            "stream.pipeThrough(new ReplaceContentTextTransformer(engine));"
          ].join("\n")
        );
      }
    );

    it("renames the Node adapter AsyncReplaceContentTransform to ReplaceContentTransform", () => {
      const { output } = run(
        'import { AsyncReplaceContentTransform } from "replace-content-transformer/node";',
        "new AsyncReplaceContentTransform(engine);"
      );

      expect(output).toBe(
        [
          'import { ReplaceContentTransform } from "replace-content-transformer/node";',
          "new ReplaceContentTransform(engine);"
        ].join("\n")
      );
    });

    it("leaves the Node adapter ReplaceContentTransform as it is", () => {
      const { output } = run(
        'import { ReplaceContentTransform } from "replace-content-transformer/node";',
        "new ReplaceContentTransform(engine);"
      );

      expect(output).toBeNull();
    });

    it("leaves the web ReplaceContentTransformer as the byte adapter in a file that already imports 4.0 names", () => {
      const { output } = run(
        'import { ReplaceContentTransformer } from "replace-content-transformer/web";',
        'import { SerialTransformEngine } from "replace-content-transformer";',
        "response.body.pipeThrough(new ReplaceContentTransformer(new SerialTransformEngine(options)));"
      );

      expect(output).toBeNull();
    });
  });

  describe("merging pairs", () => {
    it("merges a sync and an async adapter into one specifier", () => {
      const { output } = run(
        'import { ReplaceContentTransformer, AsyncReplaceContentTransformer } from "replace-content-transformer/web";',
        "new ReplaceContentTransformer(sync);",
        "new AsyncReplaceContentTransformer(async);"
      );

      expect(output).toBe(
        [
          'import { ReplaceContentTextTransformer } from "replace-content-transformer/web";',
          "new ReplaceContentTextTransformer(sync);",
          "new ReplaceContentTextTransformer(async);"
        ].join("\n")
      );
    });

    it("merges pairs imported in separate declarations, so the name isn't bound twice", () => {
      const { output } = run(
        'import type { SyncTransformEngine } from "replace-content-transformer";',
        'import type { AsyncTransformEngine } from "replace-content-transformer";',
        "let engines: [SyncTransformEngine, AsyncTransformEngine];"
      );

      expect(output).toBe(
        [
          'import type { TransformEngine } from "replace-content-transformer";',
          "let engines: [TransformEngine, TransformEngine];"
        ].join("\n")
      );
    });

    it("keeps the value import when one of a merged pair was imported as a type only", () => {
      const { output } = run(
        'import { type SyncReplacementTransformEngine, AsyncSerialReplacementTransformEngine } from "replace-content-transformer";',
        "new AsyncSerialReplacementTransformEngine(options);"
      );

      expect(output).toContain('import { SerialTransformEngine } from "replace-content-transformer";');
    });

    it("keeps the value import when the type-only one of a pair is in its own declaration", () => {
      const { output } = run(
        'import type { SyncReplacementTransformEngine } from "replace-content-transformer";',
        'import { AsyncSerialReplacementTransformEngine } from "replace-content-transformer";',
        "new AsyncSerialReplacementTransformEngine(options);"
      );

      expect(output).toBe(
        [
          'import { SerialTransformEngine } from "replace-content-transformer";',
          "new SerialTransformEngine(options);"
        ].join("\n")
      );
    });

    it("merges an old name into the 4.0 name the file already imports", () => {
      const { output } = run(
        'import { SerialTransformEngine, AsyncSerialReplacementTransformEngine } from "replace-content-transformer";',
        "new AsyncSerialReplacementTransformEngine(options);"
      );

      expect(output).toBe(
        [
          'import { SerialTransformEngine } from "replace-content-transformer";',
          "new SerialTransformEngine(options);"
        ].join("\n")
      );
    });

    it("gives each a 4.0 replacement function type of its own when both 3.x ones are imported", () => {
      const { output } = run(
        'import type { SyncReplacementFn, AsyncSerialReplacementFn } from "replace-content-transformer";',
        "let sync: SyncReplacementFn<string>;",
        "let async: AsyncSerialReplacementFn<string>;"
      );

      expect(output).toBe(
        [
          'import type { SerialReplacementFn } from "replace-content-transformer";',
          "let sync: SerialReplacementFn<string, string | Iterable<string>>;",
          "let async: SerialReplacementFn<string>;"
        ].join("\n")
      );
    });
  });

  describe("local names", () => {
    it("keeps a local alias, renaming only the imported name", () => {
      const { output } = run(
        'import { AsyncLookaheadTransformEngine as Engine } from "replace-content-transformer";',
        "new Engine(options);"
      );

      expect(output).toBe(
        [
          'import { LookaheadTransformEngine as Engine } from "replace-content-transformer";',
          "new Engine(options);"
        ].join("\n")
      );
    });

    it("adds SyncReplacementFn's return type through an alias", () => {
      const { output } = run(
        'import type { SyncReplacementFn as Fn } from "replace-content-transformer";',
        "let replace: Fn<string>;"
      );

      expect(output).toBe(
        [
          'import type { SerialReplacementFn as Fn } from "replace-content-transformer";',
          "let replace: Fn<string, string | Iterable<string>>;"
        ].join("\n")
      );
    });

    it("keeps both aliases of a merged pair", () => {
      const { output } = run(
        'import { SyncReplacementTransformEngine as Sync, AsyncSerialReplacementTransformEngine as Async } from "replace-content-transformer";'
      );

      expect(output).toBe(
        'import { SerialTransformEngine as Sync, SerialTransformEngine as Async } from "replace-content-transformer";'
      );
    });

    it("keeps the old local name as an alias when the 4.0 name is already taken in the file", () => {
      const { output } = run(
        'import type { SyncTransformEngine } from "replace-content-transformer";',
        "interface TransformEngine {}",
        "let engine: SyncTransformEngine;"
      );

      expect(output).toBe(
        [
          'import type { TransformEngine as SyncTransformEngine } from "replace-content-transformer";',
          "interface TransformEngine {}",
          "let engine: SyncTransformEngine;"
        ].join("\n")
      );
    });

    it("leaves property names that match an old name alone", () => {
      const { output } = run(
        'import { AsyncLookaheadTransformEngine } from "replace-content-transformer";',
        "const engines = { AsyncLookaheadTransformEngine: new AsyncLookaheadTransformEngine(options) };",
        "engines.AsyncLookaheadTransformEngine.end();"
      );

      expect(output).toBe(
        [
          'import { LookaheadTransformEngine } from "replace-content-transformer";',
          "const engines = { AsyncLookaheadTransformEngine: new LookaheadTransformEngine(options) };",
          "engines.AsyncLookaheadTransformEngine.end();"
        ].join("\n")
      );
    });
  });

  describe("only this package's names", () => {
    it("leaves a ReplacementFn imported from another package alone", () => {
      const { output } = run(
        'import type { ReplacementFn } from "some-other-package";',
        "let replace: ReplacementFn<string>;"
      );

      expect(output).toBeNull();
    });

    it("leaves a ReplacementFn declared in the file alone", () => {
      const { output } = run("type ReplacementFn<T> = (match: T) => string;", "let replace: ReplacementFn<string>;");

      expect(output).toBeNull();
    });

    it("renames only names from the entry point that exported them in 3.x", () => {
      const { output } = run(
        'import { ReplaceContentTransformer } from "replace-content-transformer";',
        'import { SyncReplacementTransformEngine } from "replace-content-transformer/web";'
      );

      expect(output).toBeNull();
    });
  });

  describe("other ways of importing", () => {
    it("renames members of a namespace import", () => {
      const { output } = run(
        'import * as rct from "replace-content-transformer";',
        "let engine: rct.SyncTransformEngine = new rct.AsyncLookaheadTransformEngine(options);"
      );

      expect(output).toBe(
        [
          'import * as rct from "replace-content-transformer";',
          "let engine: rct.TransformEngine = new rct.LookaheadTransformEngine(options);"
        ].join("\n")
      );
    });

    it("adds SyncReplacementFn's return type through a namespace import", () => {
      const { output } = run(
        'import type * as rct from "replace-content-transformer";',
        "let replace: rct.SyncReplacementFn<string>;"
      );

      expect(output).toContain("let replace: rct.SerialReplacementFn<string, string | Iterable<string>>;");
    });

    it("renames names destructured from require(), keeping aliases and merging pairs", () => {
      const { output } = run(
        'const { ReplaceContentTransformer, AsyncReplaceContentTransformer, ReplaceContentTransformer: Text } = require("replace-content-transformer/web");',
        "new AsyncReplaceContentTransformer(engine);"
      );

      expect(output.replace(/\s+/g, " ")).toBe(
        'const { ReplaceContentTextTransformer, ReplaceContentTextTransformer: Text } = require("replace-content-transformer/web"); new ReplaceContentTextTransformer(engine);'
      );
    });

    it("merges a pair destructured from require() in separate declarations into one", () => {
      const { output } = run(
        'const { SyncTransformEngine } = require("replace-content-transformer");',
        'const { AsyncTransformEngine } = require("replace-content-transformer");',
        "use(SyncTransformEngine, AsyncTransformEngine);"
      );

      expect(output).toBe(
        [
          'const { TransformEngine } = require("replace-content-transformer");',
          "use(TransformEngine, TransformEngine);"
        ].join("\n")
      );
    });

    it("keeps a pair destructured from require() in different scopes in separate declarations", () => {
      const { output } = run(
        'const { SyncTransformEngine } = require("replace-content-transformer");',
        'function f() { const { AsyncTransformEngine } = require("replace-content-transformer"); return AsyncTransformEngine; }'
      );

      expect(output).toBe(
        [
          'const { TransformEngine } = require("replace-content-transformer");',
          'function f() { const { TransformEngine } = require("replace-content-transformer"); return TransformEngine; }'
        ].join("\n")
      );
    });

    it("renames an optional member of a namespace import", () => {
      const { output } = run(
        'import * as rct from "replace-content-transformer";',
        "rct?.AsyncLookaheadTransformEngine(options);"
      );

      expect(output).toContain("rct?.LookaheadTransformEngine(options);");
    });

    it("renames members of a required module", () => {
      const { output } = run(
        'const rct = require("replace-content-transformer/node");',
        "new rct.AsyncReplaceContentTransform(engine);"
      );

      expect(output).toContain("new rct.ReplaceContentTransform(engine);");
    });

    it("keeps a re-export's public 3.x name, and reports it", () => {
      const { output, reports } = run(
        'export { AsyncLookaheadTransformEngine } from "replace-content-transformer";'
      );

      expect(output).toBe(
        'export { LookaheadTransformEngine as AsyncLookaheadTransformEngine } from "replace-content-transformer";'
      );
      expect(reports).toEqual([
        expect.stringContaining("line 1: re-exports LookaheadTransformEngine as AsyncLookaheadTransformEngine")
      ]);
    });
  });

  describe("round-1 cases", () => {
    it("keeps a local export of a renamed import under its 3.x name, and reports it", () => {
      const { output, reports } = run(
        'import { AsyncLookaheadTransformEngine } from "replace-content-transformer";',
        "export { AsyncLookaheadTransformEngine };"
      );

      expect(output).toBe(
        [
          'import { LookaheadTransformEngine } from "replace-content-transformer";',
          "export { LookaheadTransformEngine as AsyncLookaheadTransformEngine };"
        ].join("\n")
      );
      expect(reports).toEqual([expect.stringContaining("line 2: re-exports LookaheadTransformEngine as AsyncLookaheadTransformEngine")]);
    });

    it("keeps the key of a shorthand property whose value is renamed", () => {
      const { output } = run(
        'import { AsyncLookaheadTransformEngine } from "replace-content-transformer";',
        "const engines = { AsyncLookaheadTransformEngine };"
      );

      expect(output).toContain("const engines = { AsyncLookaheadTransformEngine: LookaheadTransformEngine };");
    });

    it.each([
      ["require() destructuring", 'const { SerialTransformEngine } = require("replace-content-transformer");'],
      ["a namespace import's member", 'import * as rct from "replace-content-transformer";\nnew rct.SerialTransformEngine(options);'],
      ["a required module's member", 'const rct = require("replace-content-transformer");\nnew rct.SerialTransformEngine(options);'],
      ["a re-export", 'export { SerialTransformEngine } from "replace-content-transformer";']
    ])("leaves the web ReplaceContentTransformer as the byte adapter when %s uses a 4.0 name", (_, newNameUse) => {
      const { output } = run(
        'import { ReplaceContentTransformer } from "replace-content-transformer/web";',
        newNameUse,
        "new ReplaceContentTransformer(engine);"
      );

      expect(output).toBeNull();
    });

    it("keeps a re-export specifier's inline type", () => {
      const { output } = run('export { type ReplacementFn } from "replace-content-transformer";');

      expect(output).toBe('export { type LookaheadReplacementFn as ReplacementFn } from "replace-content-transformer";');
    });

    it("adds the replacement type argument to an interface extending the sync engine's options", () => {
      const { output } = run(
        'import type { SyncReplacementTransformEngineOptions, SerialReplacementFn } from "replace-content-transformer";',
        "interface Options extends SyncReplacementTransformEngineOptions<State, Match> {}"
      );

      expect(output).toContain(
        "interface Options extends SerialTransformEngineOptions<State, Match, string | SerialReplacementFn<Match, string | Iterable<string>>> {}"
      );
    });

    it("adds SyncReplacementFn's return type to a type destructured from require()", () => {
      const { output } = run(
        'const { SyncReplacementFn } = require("replace-content-transformer");',
        "let replace: SyncReplacementFn<string>;"
      );

      expect(output).toContain("let replace: SerialReplacementFn<string, string | Iterable<string>>;");
    });

    it("keeps comments on a renamed import specifier", () => {
      const { output } = run(
        "import {",
        "  // the sync engine",
        "  SyncReplacementTransformEngine,",
        '} from "replace-content-transformer";'
      );

      expect(output).toContain("// the sync engine");
    });

    it("keeps comments on a renamed require() property", () => {
      const { output } = run(
        "const {",
        "  // the async adapter",
        "  AsyncReplaceContentTransform,",
        '} = require("replace-content-transformer/node");'
      );

      expect(output).toContain("// the async adapter");
    });

    it("reuses an aliased SyncReplacementFn import for the sync engine's replacement type", () => {
      const { output } = run(
        'import { SyncReplacementTransformEngine, type SyncReplacementFn as Fn } from "replace-content-transformer";',
        "let engine: SyncReplacementTransformEngine<State>;"
      );

      expect(output).toBe(
        [
          'import { SerialTransformEngine, type SerialReplacementFn as Fn } from "replace-content-transformer";',
          "let engine: SerialTransformEngine<State, string, string | Fn<string, string | Iterable<string>>>;"
        ].join("\n")
      );
    });

    it("renames an import type query, adding SyncReplacementFn's return type", () => {
      const { output } = run('let replace: import("replace-content-transformer").SyncReplacementFn<string>;');

      expect(output).toBe(
        'let replace: import("replace-content-transformer").SerialReplacementFn<string, string | Iterable<string>>;'
      );
    });

    it("adds the replacement type argument to an import type query of the sync engine", () => {
      const { output } = run('let engine: import("replace-content-transformer").SyncReplacementTransformEngine<State>;');

      expect(output).toBe(
        'let engine: import("replace-content-transformer").SerialTransformEngine<State, string, string | import("replace-content-transformer").SerialReplacementFn<string, string | Iterable<string>>>;'
      );
    });

    it("renames an import type query of a web adapter", () => {
      const { output } = run('let adapter: import("replace-content-transformer/web").AsyncReplaceContentTransformer;');

      expect(output).toBe('let adapter: import("replace-content-transformer/web").ReplaceContentTextTransformer;');
    });
  });

  describe("async serial engine calls", () => {
    it.each([
      ["chained with then()", "engine.write(chunk).then(next);", 3],
      ["returned", "function flush() { return engine.end(); }", 3],
      ["passed on", "track(engine.write(chunk));", 3]
    ])("reports a write() or end() whose Promise is used, %s, since 4.0 may return undefined", (_, use, line) => {
      const { reports } = run(
        'import { AsyncSerialReplacementTransformEngine } from "replace-content-transformer";',
        "const engine = new AsyncSerialReplacementTransformEngine(options);",
        use
      );

      expect(reports).toEqual([
        expect.stringContaining(`line ${line}: engine's write() and end() return undefined in 4.0 when they finish synchronously`)
      ]);
    });

    it.each([
      ["awaited", "await engine.write(chunk);"],
      ["a statement of its own", "engine.end();"]
    ])("stays quiet about a write() or end() %s", (_, use) => {
      const { reports } = run(
        'import { AsyncSerialReplacementTransformEngine } from "replace-content-transformer";',
        "const engine = new AsyncSerialReplacementTransformEngine(options);",
        use
      );

      expect(reports).toEqual([]);
    });

    it.each([
      ["wrapped in Promise.resolve()", "await Promise.resolve(engine.write(chunk));"],
      ["in Promise.all()", "await Promise.all([engine.write(a), engine.end()]);"],
      ["voided", "void engine.write(chunk);"],
      ["returned from an async function", "async function flush() { return engine.end(); }"],
      ["the body of an async arrow function", "const flush = async () => engine.end();"],
      ["on a parameter that shadows the engine", "function use(engine) { return engine.write(chunk); }"]
    ])("stays quiet about a write() or end() %s", (_, use) => {
      const { reports } = run(
        'import { AsyncSerialReplacementTransformEngine } from "replace-content-transformer";',
        "const engine = new AsyncSerialReplacementTransformEngine(options);",
        use
      );

      expect(reports).toEqual([]);
    });

    it("reports a write() on an engine assigned after its declaration", () => {
      const { reports } = run(
        'import { AsyncSerialReplacementTransformEngine } from "replace-content-transformer";',
        "let engine;",
        "engine = new AsyncSerialReplacementTransformEngine(options);",
        "engine.write(chunk).then(next);"
      );

      expect(reports).toEqual([expect.stringContaining("line 4: engine's write() and end() return undefined")]);
    });

    it("stays quiet about the sync engine's calls", () => {
      const { reports } = run(
        'import { SyncReplacementTransformEngine } from "replace-content-transformer";',
        "const engine = new SyncReplacementTransformEngine(options);",
        "track(engine.write(chunk));"
      );

      expect(reports).toEqual([]);
    });
  });

  describe("round-2 cases", () => {
    it("leaves a destructured parameter that shadows a renamed import, and its uses, alone", () => {
      const { output } = run(
        'import { AsyncLookaheadTransformEngine } from "replace-content-transformer";',
        "new AsyncLookaheadTransformEngine(options);",
        "function f({ AsyncLookaheadTransformEngine }: any) { return AsyncLookaheadTransformEngine; }"
      );

      expect(output).toBe(
        [
          'import { LookaheadTransformEngine } from "replace-content-transformer";',
          "new LookaheadTransformEngine(options);",
          "function f({ AsyncLookaheadTransformEngine }: any) { return AsyncLookaheadTransformEngine; }"
        ].join("\n")
      );
    });

    it("leaves a destructured default that refers to its own binding alone", () => {
      const { output } = run(
        'import { AsyncLookaheadTransformEngine } from "replace-content-transformer";',
        "function f({ AsyncLookaheadTransformEngine = AsyncLookaheadTransformEngine } = {}) {}"
      );

      expect(output).toContain("function f({ AsyncLookaheadTransformEngine = AsyncLookaheadTransformEngine } = {}) {}");
    });

    it("keeps the old name as an alias when a local binding elsewhere already has the 4.0 name", () => {
      const { output } = run(
        'import { AsyncLookaheadTransformEngine } from "replace-content-transformer";',
        "function f(LookaheadTransformEngine) { return new AsyncLookaheadTransformEngine(LookaheadTransformEngine); }"
      );

      expect(output).toBe(
        [
          'import { LookaheadTransformEngine as AsyncLookaheadTransformEngine } from "replace-content-transformer";',
          "function f(LookaheadTransformEngine) { return new AsyncLookaheadTransformEngine(LookaheadTransformEngine); }"
        ].join("\n")
      );
    });

    it("keeps a comment on the alias of a require()-destructured property", () => {
      const { output } = run('const { AsyncReplaceContentTransform: /* the adapter */ Adapter } = require("replace-content-transformer/node");');

      expect(output).toContain("/* the adapter */");
    });

    it("keeps the comment of a specifier merged into its pair", () => {
      const { output } = run(
        "import {",
        "  ReplaceContentTransformer,",
        "  // the async one",
        "  AsyncReplaceContentTransformer,",
        '} from "replace-content-transformer/web";'
      );

      expect(output).toContain("// the async one");
    });

    it("stays quiet about a re-export under an alias, whose public name doesn't change", () => {
      const { output, reports } = run('export { AsyncLookaheadTransformEngine as Engine } from "replace-content-transformer";');

      expect(output).toBe('export { LookaheadTransformEngine as Engine } from "replace-content-transformer";');
      expect(reports).toEqual([]);
    });
  });

  describe("round-3 cases", () => {
    it("merges the Node adapter pair when the file uses the sync one", () => {
      const { output } = run(
        'import { ReplaceContentTransform, AsyncReplaceContentTransform } from "replace-content-transformer/node";',
        "new ReplaceContentTransform(sync);",
        "new AsyncReplaceContentTransform(async);"
      );

      expect(output).toBe(
        [
          'import { ReplaceContentTransform } from "replace-content-transformer/node";',
          "new ReplaceContentTransform(sync);",
          "new ReplaceContentTransform(async);"
        ].join("\n")
      );
    });

    it("merges an old name into a 4.0 name the file already imports and uses", () => {
      const { output } = run(
        'import { SerialTransformEngine, AsyncSerialReplacementTransformEngine } from "replace-content-transformer";',
        "new SerialTransformEngine(sync);",
        "new AsyncSerialReplacementTransformEngine(async);"
      );

      expect(output).toBe(
        [
          'import { SerialTransformEngine } from "replace-content-transformer";',
          "new SerialTransformEngine(sync);",
          "new SerialTransformEngine(async);"
        ].join("\n")
      );
    });

    it("isn't kept from the 4.0 name by another package's export of that name under an alias", () => {
      const { output } = run(
        'import { SerialTransformEngine as OtherEngine } from "some-other-package";',
        'import { AsyncSerialReplacementTransformEngine } from "replace-content-transformer";',
        "new AsyncSerialReplacementTransformEngine(options);"
      );

      expect(output).toContain('import { SerialTransformEngine } from "replace-content-transformer";');
    });

    it("keeps the old name as an alias when the 4.0 name is imported from this package as another export", () => {
      const { output } = run(
        'import { LookaheadTransformEngine as SerialTransformEngine, AsyncSerialReplacementTransformEngine } from "replace-content-transformer";',
        "new SerialTransformEngine(options);",
        "new AsyncSerialReplacementTransformEngine(options);"
      );

      expect(output).toContain("SerialTransformEngine as AsyncSerialReplacementTransformEngine");
    });

    it("keeps a side-effect import of the package", () => {
      const { output } = run(
        'import "replace-content-transformer";',
        'import type { ReplacementFn } from "replace-content-transformer";',
        "let replace: ReplacementFn<string>;"
      );

      expect(output).toBe(
        [
          'import "replace-content-transformer";',
          'import type { LookaheadReplacementFn } from "replace-content-transformer";',
          "let replace: LookaheadReplacementFn<string>;"
        ].join("\n")
      );
    });

    it.each([
      ["an abstract method", "abstract class Replacer { abstract ReplacementFn(): void; }"],
      ["a method overload", "class Replacer { ReplacementFn(a: string): void; ReplacementFn(a) {} }"],
      ["a private field", "class Replacer { #ReplacementFn = 1; }"],
      ["an enum member", "enum Replacers { ReplacementFn }"]
    ])("leaves %s named like a renamed import alone", (_, declaration) => {
      const { output } = run(
        'import type { ReplacementFn } from "replace-content-transformer";',
        "let replace: ReplacementFn<string>;",
        declaration
      );

      expect(output).toContain(declaration);
    });

    it.each([
      ["export * from", 'export * from "replace-content-transformer/node";'],
      ["export * as", 'export * as rct from "replace-content-transformer/node";']
    ])("reports %s this package, whose 3.x names its consumers lose", (_, reExport) => {
      const { output, reports } = run(reExport);

      expect(output).toBeNull();
      expect(reports).toEqual([
        "line 1: re-exports everything from replace-content-transformer/node, so your own consumers see its 4.0 names in place of " +
          "AsyncReplaceContentTransform (now ReplaceContentTransform); re-export the 3.x names they import if those should keep working"
      ]);
    });
  });

  describe("shadowed names", () => {
    const syncEngineImport = 'import { SyncReplacementTransformEngine } from "replace-content-transformer";';

    it("leaves a new of a parameter that shadows the sync engine without a third type argument", () => {
      const { output } = run(
        syncEngineImport,
        "function f(SyncReplacementTransformEngine) { return new SyncReplacementTransformEngine<State>(options); }"
      );

      expect(output).toContain("return new SyncReplacementTransformEngine<State>(options);");
    });

    it("renames and widens a type reference that a parameter of the same name doesn't shadow", () => {
      const { output } = run(
        syncEngineImport,
        "function f(SyncReplacementTransformEngine) { let engine: SyncReplacementTransformEngine<State>; }"
      );

      expect(output).toContain(
        "let engine: SerialTransformEngine<State, string, string | SerialReplacementFn<string, string | Iterable<string>>>;"
      );
    });

    it("leaves a type parameter that shadows the sync engine, and its uses, alone", () => {
      const { output } = run(
        syncEngineImport,
        "function f<SyncReplacementTransformEngine>(engine: SyncReplacementTransformEngine<State>) {",
        "  class Wrapper implements SyncReplacementTransformEngine<State> {}",
        "}"
      );

      expect(output).toContain(
        [
          "function f<SyncReplacementTransformEngine>(engine: SyncReplacementTransformEngine<State>) {",
          "  class Wrapper implements SyncReplacementTransformEngine<State> {}",
          "}"
        ].join("\n")
      );
    });

    it("leaves a local type alias that shadows the sync engine, and its uses, alone", () => {
      const { output } = run(
        syncEngineImport,
        "function f() { type SyncReplacementTransformEngine<T> = T; let engine: SyncReplacementTransformEngine<State>; }"
      );

      expect(output).toContain(
        "function f() { type SyncReplacementTransformEngine<T> = T; let engine: SyncReplacementTransformEngine<State>; }"
      );
    });

    it("leaves a local class that shadows the sync engine, and its uses as a type, alone", () => {
      const { output } = run(
        syncEngineImport,
        "function f() { class SyncReplacementTransformEngine<T> {} let engine: SyncReplacementTransformEngine<State>; }"
      );

      expect(output).toContain(
        "function f() { class SyncReplacementTransformEngine<T> {} let engine: SyncReplacementTransformEngine<State>; }"
      );
    });

    it("leaves a member of a parameter that shadows a namespace import alone", () => {
      const { output } = run(
        'import * as rct from "replace-content-transformer";',
        "function f(rct) { return new rct.AsyncLookaheadTransformEngine(options); }"
      );

      expect(output).toBeNull();
    });

    it("renames the 3.x web adapter when a 4.0 name is used only through a parameter that shadows a namespace import", () => {
      const { output } = run(
        'import { ReplaceContentTransformer } from "replace-content-transformer/web";',
        'import * as rct from "replace-content-transformer";',
        "function f(rct) { return rct.SerialTransformEngine; }",
        "new ReplaceContentTransformer(engine);"
      );

      expect(output).toContain("new ReplaceContentTextTransformer(engine);");
    });

    it("renames and widens a namespaced type whose namespace a parameter of the same name doesn't shadow", () => {
      const { output } = run(
        'import * as rct from "replace-content-transformer";',
        "function f(rct) { let engine: rct.SyncReplacementTransformEngine<State>; }"
      );

      expect(output).toContain(
        "let engine: rct.SerialTransformEngine<State, string, string | rct.SerialReplacementFn<string, string | Iterable<string>>>;"
      );
    });

    it("renames the uses of a name destructured from require() inside a function", () => {
      const { output } = run(
        "function f() {",
        '  const { AsyncLookaheadTransformEngine } = require("replace-content-transformer");',
        "  return new AsyncLookaheadTransformEngine(options);",
        "}"
      );

      expect(output).toContain("return new LookaheadTransformEngine(options);");
    });

    it("renames a member of a namespace required inside a function", () => {
      const { output } = run(
        "function f() {",
        '  const rct = require("replace-content-transformer");',
        "  return new rct.AsyncLookaheadTransformEngine(options);",
        "}"
      );

      expect(output).toContain("return new rct.LookaheadTransformEngine(options);");
    });
  });

  describe("regex match type", () => {
    const message =
      "line 2: RegExpExecArray: a match from RegexSearchStrategy is a StreamRegexMatch in 4.0, whose index and indices are stream-relative and whose input is undefined. Where this types one, use StreamRegexMatch";

    it.each([
      ["RegexSearchStrategy", 'import { RegexSearchStrategy } from "replace-content-transformer";'],
      ["searchStrategyFactory", 'import { searchStrategyFactory } from "replace-content-transformer";'],
      ["a namespace import", 'import * as rct from "replace-content-transformer";\nrct.RegexSearchStrategy;'],
      ["require() destructuring", 'const { RegexSearchStrategy } = require("replace-content-transformer");']
    ])("reports, without changing, a RegExpExecArray type in a file that uses %s", (_, regexUse) => {
      const lines = regexUse.split("\n");
      const { output, reports } = run(
        lines[0],
        "const replacement = (match: RegExpExecArray) => match[1];",
        ...lines.slice(1)
      );

      expect(output).toBeNull();
      expect(reports).toEqual([message]);
    });

    it("stays quiet about a RegExpExecArray type in a file that uses no regex strategy", () => {
      const { reports } = run(
        'import { StringAnchorSearchStrategy } from "replace-content-transformer";',
        "const replacement = (match: RegExpExecArray) => match[1];"
      );

      expect(reports).toEqual([]);
    });
  });

  describe("formatting", () => {
    it("keeps single quotes on an import it reprints", () => {
      const { output } = run(
        "import { SyncReplacementTransformEngine } from 'replace-content-transformer';",
        "let engine: SyncReplacementTransformEngine<State>;"
      );

      expect(output).toContain(
        "import { SerialTransformEngine, type SerialReplacementFn } from 'replace-content-transformer';"
      );
    });
  });

  describe("idempotence", () => {
    it.each([
      [
        "engines and their types",
        'import { SyncReplacementTransformEngine, AsyncSerialReplacementTransformEngine, type SyncReplacementFn } from "replace-content-transformer";',
        "let engine: SyncReplacementTransformEngine<State>;",
        "let replace: SyncReplacementFn<string>;",
        "new AsyncSerialReplacementTransformEngine(options);"
      ],
      [
        "adapters",
        'import { ReplaceContentTransformer, AsyncReplaceContentTransformer } from "replace-content-transformer/web";',
        "new ReplaceContentTransformer(engine);"
      ],
      ["re-exports", 'export { SyncTransformEngine } from "replace-content-transformer";']
    ])("changes nothing on a second run over %s", (_, ...lines) => {
      const once = run(...lines).output;

      expect(once).not.toBeNull();
      expect(run(...once.split("\n")).output).toBeNull();
    });
  });
});
