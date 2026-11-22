import { describe, expect, it } from "vitest";
import transform from "./report-text-stream-pipelines.js";
import { runner } from "./test-harness.js";

const run = runner(transform);

const pipeline = (adapterImport, adapter) => [
  adapterImport,
  "response.body",
  "  .pipeThrough(new TextDecoderStream())",
  `  .pipeThrough(new TransformStream(new ${adapter}(engine)))`,
  "  .pipeThrough(new TextEncoderStream());"
];

describe("text stream pipeline report", () => {
  it("never edits the file", () => {
    const { output } = run(
      ...pipeline('import { ReplaceContentTextTransformer } from "replace-content-transformer/web";', "ReplaceContentTextTransformer")
    );

    expect(output).toBeNull();
  });

  it.each(["ReplaceContentTextTransformer", "AsyncReplaceContentTransformer"])(
    "reports a %s between a TextDecoderStream and a TextEncoderStream, which the byte adapter can replace",
    (adapter) => {
      const { reports } = run(...pipeline(`import { ${adapter} } from "replace-content-transformer/web";`, adapter));

      expect(reports).toEqual([
        expect.stringContaining(
          "line 4: the string adapter sits between a TextDecoderStream and a TextEncoderStream. The byte adapter, ReplaceContentTransformer, can replace all three"
        )
      ]);
    }
  );

  it("treats a 3.x ReplaceContentTransformer as the string adapter", () => {
    const { report } = run(
      ...pipeline('import { ReplaceContentTransformer } from "replace-content-transformer/web";', "ReplaceContentTransformer")
    );

    expect(report).toContain("the string adapter sits between");
  });

  it("names the byte order mark the byte adapter keeps and TextDecoderStream drops", () => {
    const { report } = run(
      ...pipeline('import { ReplaceContentTextTransformer } from "replace-content-transformer/web";', "ReplaceContentTextTransformer")
    );

    expect(report).toContain("byte order mark");
  });

  it("reports the 4.0 byte adapter fed by a TextDecoderStream, whose strings error it", () => {
    const { reports } = run(
      'import { ReplaceContentTransformer } from "replace-content-transformer/web";',
      'import { SerialTransformEngine } from "replace-content-transformer";',
      "response.body",
      "  .pipeThrough(new TextDecoderStream())",
      "  .pipeThrough(new TransformStream(new ReplaceContentTransformer(new SerialTransformEngine(options))));"
    );

    expect(reports).toEqual([
      expect.stringContaining("line 5: the byte adapter, ReplaceContentTransformer, is given the strings a TextDecoderStream emits")
    ]);
  });

  it("finds an adapter held in a variable and an aliased import", () => {
    const { report } = run(
      'import { ReplaceContentTextTransformer as Replacer } from "replace-content-transformer/web";',
      "const replacer = new Replacer(engine);",
      "body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream(replacer)).pipeThrough(new TextEncoderStream());"
    );

    expect(report).toContain("line 3: the string adapter sits between");
  });

  it("finds a TransformStream held in a variable", () => {
    const { report } = run(
      'import { ReplaceContentTextTransformer } from "replace-content-transformer/web";',
      "const replacing = new TransformStream(new ReplaceContentTextTransformer(engine));",
      "body.pipeThrough(new TextDecoderStream()).pipeThrough(replacing).pipeThrough(new TextEncoderStream());"
    );

    expect(report).toContain("line 3: the string adapter sits between");
  });

  it("finds an adapter through a namespace import", () => {
    const { report } = run(
      ...pipeline('import * as web from "replace-content-transformer/web";', "web.ReplaceContentTextTransformer")
    );

    expect(report).toContain("line 4: the string adapter sits between");
  });

  it("finds a pipeline on an optional chain", () => {
    const { report } = run(
      'import { ReplaceContentTextTransformer } from "replace-content-transformer/web";',
      "res.body",
      "  ?.pipeThrough(new TextDecoderStream())",
      "  .pipeThrough(new TransformStream(new ReplaceContentTextTransformer(engine)))",
      "  .pipeThrough(new TextEncoderStream());"
    );

    expect(report).toContain("line 4: the string adapter sits between");
  });

  it.each(['"utf-8"', '"utf8"', "'UTF-8'"])("finds a pipeline whose TextDecoderStream names UTF-8 as %s", (label) => {
    const { report } = run(
      'import { ReplaceContentTextTransformer } from "replace-content-transformer/web";',
      `body.pipeThrough(new TextDecoderStream(${label})).pipeThrough(new TransformStream(new ReplaceContentTextTransformer(engine))).pipeThrough(new TextEncoderStream());`
    );

    expect(report).toContain("line 2: the string adapter sits between");
  });

  it.each(['"shift_jis"', "encoding"])(
    "stays quiet about a TextDecoderStream for %s, which may not be UTF-8, the only encoding the byte adapter reads",
    (label) => {
      const { reports } = run(
        'import { ReplaceContentTextTransformer } from "replace-content-transformer/web";',
        `body.pipeThrough(new TextDecoderStream(${label})).pipeThrough(new TransformStream(new ReplaceContentTextTransformer(engine))).pipeThrough(new TextEncoderStream());`
      );

      expect(reports).toEqual([]);
    }
  );

  it.each([
    ["require() destructuring", 'const { SerialTransformEngine } = require("replace-content-transformer");'],
    ["a namespace import's member", 'import * as rct from "replace-content-transformer";\nrct.SerialTransformEngine;']
  ])("treats ReplaceContentTransformer as the 4.0 byte adapter when %s uses a 4.0 name", (_, newNameUse) => {
    const { report } = run(
      'import { ReplaceContentTransformer } from "replace-content-transformer/web";',
      newNameUse,
      "body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream(new ReplaceContentTransformer(engine)));"
    );

    expect(report).toContain("the byte adapter, ReplaceContentTransformer, is given the strings");
  });

  it.each(["undefined", "`utf-8`"])("finds a pipeline whose TextDecoderStream label is %s", (label) => {
    const { report } = run(
      'import { ReplaceContentTextTransformer } from "replace-content-transformer/web";',
      `body.pipeThrough(new TextDecoderStream(${label})).pipeThrough(new TransformStream(new ReplaceContentTextTransformer(engine))).pipeThrough(new TextEncoderStream());`
    );

    expect(report).toContain("line 2: the string adapter sits between");
  });

  it.each(['"utf-8", { fatal: true }', "undefined, options"])(
    "stays quiet about a TextDecoderStream given (%s), which may be fatal where the byte adapter writes U+FFFD",
    (args) => {
      const { reports } = run(
        'import { ReplaceContentTextTransformer } from "replace-content-transformer/web";',
        `body.pipeThrough(new TextDecoderStream(${args})).pipeThrough(new TransformStream(new ReplaceContentTextTransformer(engine))).pipeThrough(new TextEncoderStream());`
      );

      expect(reports).toEqual([]);
    }
  );

  it("finds a pipeline whose TextDecoderStream is explicitly not fatal", () => {
    const { report } = run(
      'import { ReplaceContentTextTransformer } from "replace-content-transformer/web";',
      'body.pipeThrough(new TextDecoderStream("utf-8", { fatal: false })).pipeThrough(new TransformStream(new ReplaceContentTextTransformer(engine))).pipeThrough(new TextEncoderStream());'
    );

    expect(report).toContain("line 2: the string adapter sits between");
  });

  it("leaves out the byte order mark caveat for a TextDecoderStream that keeps the mark too", () => {
    const { report } = run(
      'import { ReplaceContentTextTransformer } from "replace-content-transformer/web";',
      'body.pipeThrough(new TextDecoderStream("utf-8", { ignoreBOM: true })).pipeThrough(new TransformStream(new ReplaceContentTextTransformer(engine))).pipeThrough(new TextEncoderStream());'
    );

    expect(report).toContain("line 2: the string adapter sits between");
    expect(report).not.toContain("byte order mark");
  });

  it("tells a byte adapter fed by a non-UTF-8 TextDecoderStream to use the string adapter, not to drop the decoder", () => {
    const { reports } = run(
      'import { ReplaceContentTransformer } from "replace-content-transformer/web";',
      'import { SerialTransformEngine } from "replace-content-transformer";',
      'body.pipeThrough(new TextDecoderStream("shift_jis")).pipeThrough(new TransformStream(new ReplaceContentTransformer(engine)));'
    );

    expect(reports).toEqual([
      "line 3: the byte adapter, ReplaceContentTransformer, is given the strings a TextDecoderStream emits, which error it. " +
        "Use ReplaceContentTextTransformer, which keeps this decoder: the byte adapter reads only UTF-8, and writes U+FFFD for malformed input"
    ]);
  });

  it("looks through non-null assertions and casts in a chain", () => {
    const { report } = run(
      'import { ReplaceContentTextTransformer } from "replace-content-transformer/web";',
      "(body.pipeThrough(new TextDecoderStream()) as ReadableStream<string>)",
      "  .pipeThrough(new TransformStream(new ReplaceContentTextTransformer(engine)))!",
      "  .pipeThrough(new TextEncoderStream());"
    );

    expect(report).toContain("line 3: the string adapter sits between");
  });

  it("stays quiet about a string adapter whose output stays text", () => {
    const { reports } = run(
      'import { ReplaceContentTextTransformer } from "replace-content-transformer/web";',
      "body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream(new ReplaceContentTextTransformer(engine)));"
    );

    expect(reports).toEqual([]);
  });

  it("stays quiet about another package's transformer between text streams", () => {
    const { reports } = run(
      ...pipeline('import { ReplaceContentTextTransformer } from "some-other-package";', "ReplaceContentTextTransformer")
    );

    expect(reports).toEqual([]);
  });

  it("stays quiet about the byte adapter on a byte stream", () => {
    const { reports } = run(
      'import { ReplaceContentTransformer } from "replace-content-transformer/web";',
      'import { SerialTransformEngine } from "replace-content-transformer";',
      "response.body.pipeThrough(new TransformStream(new ReplaceContentTransformer(new SerialTransformEngine(options))));"
    );

    expect(reports).toEqual([]);
  });
});
