import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { text } from "node:stream/consumers";
import { ReplaceContentTransform } from "./sync-transform.js";
import { collectWritable } from "../../../test/utilities.js";
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

  it("does not call the replacement again once a data listener aborts the stopReplacingSignal on output from the same chunk", async () => {
    const abortController = new AbortController();
    const replacement = vi.fn((match: string) => match.toUpperCase());
    const transform = new ReplaceContentTransform(
      new SyncReplacementTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement,
        stopReplacingSignal: abortController.signal
      })
    );
    const chunks: string[] = [];
    transform.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString());
      if (chunks.join("").includes("{{A}}")) abortController.abort();
    });
    transform.write("x");

    transform.end("{{a}}y{{b}}z");
    await finished(transform);

    expect(chunks.join("")).toBe("x{{A}}y{{b}}z");
    expect(replacement).toHaveBeenCalledOnce();
  });

  it("lets a guard callback see that a data listener aborted the stopReplacingSignal on text reported before it", async () => {
    const abortController = new AbortController();
    const signalAbortedAtGuard: boolean[] = [];
    const transform = new ReplaceContentTransform(
      new SyncReplacementTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"], {
          maxBufferLength: 6,
          onGuardExceeded: () => {
            signalAbortedAtGuard.push(abortController.signal.aborted);
          }
        }),
        replacement: (match: string) => match.toUpperCase(),
        stopReplacingSignal: abortController.signal
      })
    );
    const chunks: string[] = [];
    transform.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString());
      if (chunks.join("").includes("x")) abortController.abort();
    });
    transform.write("w");

    transform.end("x{{123456");
    await finished(transform);

    expect(signalAbortedAtGuard).toEqual([true]);
  });

  it("stops the search straight after a replacement a data listener aborts the stopReplacingSignal on, before the strategy reaches a guard that throws", async () => {
    const abortController = new AbortController();
    const onGuardExceeded = vi.fn(() => {
      throw new Error("guard");
    });
    const transform = new ReplaceContentTransform(
      new SyncReplacementTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"], {
          maxBufferLength: 6,
          onGuardExceeded
        }),
        replacement: (match: string) => match.toUpperCase(),
        stopReplacingSignal: abortController.signal
      })
    );
    const chunks: string[] = [];
    transform.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString());
      if (chunks.join("").includes("{{A}}")) abortController.abort();
    });
    transform.write("x");

    transform.end("{{a}}{{123456");
    await finished(transform);

    expect(chunks.join("")).toBe("x{{A}}{{123456");
    expect(onGuardExceeded).not.toHaveBeenCalled();
  });

  it("lets an iterable replacement see a data listener abort the stopReplacingSignal on one of its pieces before it yields the next", async () => {
    const abortController = new AbortController();
    const replacement = vi.fn(function* (match: string) {
      yield "<";
      yield abortController.signal.aborted ? match : match.toUpperCase();
      yield ">";
    });
    const transform = new ReplaceContentTransform(
      new SyncReplacementTransformEngine({
        searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
        replacement,
        stopReplacingSignal: abortController.signal
      })
    );
    const chunks: string[] = [];
    transform.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString());
      if (chunks.join("").endsWith("<")) abortController.abort();
    });
    transform.write("x");

    transform.end("{{a}}y{{b}}z");
    await finished(transform);

    expect(chunks.join("")).toBe("x<{{a}}>y{{b}}z");
    expect(replacement).toHaveBeenCalledOnce();
  });

  describe("with a stopReplacingSignal", () => {
    const transformWithSignal = () => {
      const transform = new ReplaceContentTransform(
        new SyncReplacementTransformEngine({
          searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
          replacement: (match: string) => match.toUpperCase(),
          stopReplacingSignal: new AbortController().signal
        })
      );
      const push = vi.spyOn(transform, "push");
      const pushed = () =>
        push.mock.calls.map(([chunk]) => chunk).filter((chunk) => chunk !== null);
      return { transform, pushed };
    };

    it("stops the next replacement in the same chunk once a replacement makes the stream flow and its data listener aborts the signal", async () => {
      const abortController = new AbortController();
      const chunks: string[] = [];
      let transform: ReplaceContentTransform;
      const replacement = vi.fn((match: string) => {
        if (replacement.mock.calls.length === 1) {
          transform.on("data", (chunk: Buffer) => {
            chunks.push(chunk.toString());
            if (chunks.join("").includes("{{A}}")) abortController.abort();
          });
          transform.resume();
        }
        return match.toUpperCase();
      });
      transform = new ReplaceContentTransform(
        new SyncReplacementTransformEngine({
          searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
          replacement,
          stopReplacingSignal: abortController.signal
        })
      );
      transform.write("warm");
      await new Promise((resolve) => setImmediate(resolve));
      transform.read();

      transform.end("{{a}}{{b}}");
      await finished(transform);

      expect(chunks.join("")).toBe("{{A}}{{b}}");
      expect(replacement).toHaveBeenCalledOnce();
    });

    it("stops the next replacement once a data listener attached after an earlier write with a match aborts the signal", async () => {
      const abortController = new AbortController();
      const replacement = vi.fn((match: string) => match.toUpperCase());
      const transform = new ReplaceContentTransform(
        new SyncReplacementTransformEngine({
          searchStrategy: new StringAnchorSearchStrategy(["{{", "}}"]),
          replacement,
          stopReplacingSignal: abortController.signal
        })
      );
      transform.write("{{x}} ");
      const chunks: string[] = [];
      transform.on("data", (chunk: Buffer) => {
        chunks.push(chunk.toString());
        if (chunks.join("").includes("{{A}}")) abortController.abort();
      });
      await new Promise((resolve) => setImmediate(resolve));

      transform.end("{{a}}y{{b}}z");
      await finished(transform);

      expect(chunks.join("")).toBe("{{X}} {{A}}y{{b}}z");
      expect(replacement).toHaveBeenCalledTimes(2);
    });

    it("pushes the output so far before each replacement, and each replacement as it is made, while piped to a Writable, which can react inside push()", async () => {
      const { transform, pushed } = transformWithSignal();
      const { writable } = collectWritable();
      transform.pipe(writable);

      transform.end("x{{a}}y{{b}}z");
      await finished(writable);

      expect(pushed()).toEqual(["x", "{{A}}", "y", "{{B}}", "z"]);
    });
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
