import { describe, expect, it, vi } from "vitest";
import { SyncReplacementTransformEngine } from "../src/engines/sync-transform-engine.ts";
import { RegexSearchStrategy } from "../src/search-strategies/regex/search-strategy.ts";
import { collectEngineSink } from "./utilities.ts";

type RegexCallbackMatch = string[] & { index: number; input?: string };

describe("regex replacement callback metadata", () => {
  it("omits RegExpExecArray.input for matches in a chunk and at flush", () => {
    const replacement = vi.fn((match: RegexCallbackMatch) => match[0]);
    const engine = new SyncReplacementTransformEngine({
      searchStrategy: new RegexSearchStrategy(/\{\{\w+\}\}/),
      replacement
    });
    const { sink, chunks } = collectEngineSink();
    engine.start(sink);
    engine.write("{{first}} and ");
    engine.write("then {{second}}");
    engine.end();

    const matches = replacement.mock.calls.map(([match]) => match);
    expect(chunks.join("")).toBe("{{first}} and then {{second}}");
    expect(matches).toHaveLength(2);
    expect(matches.map((match) => match.input)).toEqual([undefined, undefined]);
  });
});
