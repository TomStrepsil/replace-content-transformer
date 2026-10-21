import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { ReplaceContentTransform } from "./sync-transform.js";
import { SyncReplacementTransformEngine } from "../../engines/index.js";
import {
  RegexSearchStrategy,
  StringAnchorSearchStrategy
} from "../../search-strategies/index.js";

describe("ReplaceContentTransform + SyncReplacementTransformEngine + StringAnchorSearchStrategy", () => {
  it("produces the same output whether or not a Buffer chunk boundary splits a multi-byte character", async () => {
    const bytes = Buffer.from("héllo {{x}} wörld");
    const transform = new ReplaceContentTransform(
      new SyncReplacementTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement: "X"
      })
    );

    const out = await text(
      Readable.from([bytes.subarray(0, 2), bytes.subarray(2)]).pipe(transform)
    );
    expect(out).toBe("héllo X wörld");
  });
});

describe("ReplaceContentTransform + SyncReplacementTransformEngine + RegexSearchStrategy", () => {
  it("keeps an astral character intact in the output when a nullable pattern skips a zero-length match in front of it", async () => {
    const transform = new ReplaceContentTransform(
      new SyncReplacementTransformEngine({
        searchStrategy: new RegexSearchStrategy(/a*/),
        replacement: "Z"
      })
    );

    const out = await text(Readable.from(["x😀ya"]).pipe(transform));
    expect(out).toBe("x😀yZ");
  });

  it("keeps an astral character intact in the output when a match ends between the two halves of its surrogate pair", async () => {
    const transform = new ReplaceContentTransform(
      new SyncReplacementTransformEngine({
        searchStrategy: new RegexSearchStrategy(/a./),
        replacement: (match) => match[0]
      })
    );

    const out = await text(Readable.from(["a😀b"]).pipe(transform));
    expect(out).toBe("a😀b");
  });
});
