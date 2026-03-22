import { describe, it, expect } from "vitest";
import { AnchorSequenceSearchStrategy } from "./search-strategy.ts";
import { BufferedIndexOfCancellableSearchStrategy } from "../buffered-indexOf-cancellable/search-strategy.ts";

describe("AnchorSequenceSearchStrategy + BufferedIndexOfCancellableSearchStrategy", () => {
  it("simple two-delimiter match", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    const results = Array.from(
      strategy.processChunk("Hello {{name}} world", state)
    );

    expect(results).toEqual([
      { isMatch: false, content: "Hello " },
      { isMatch: true, content: "{{name}}", streamIndices: [6, 14] },
      { isMatch: false, content: " worl" }
    ]);
    expect(strategy.flush(state)).toEqual("d");
  });

  it("cross-chunk match", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    const results = Array.from(strategy.processChunk("Hello {{na", state));
    const results2 = Array.from(strategy.processChunk("me}} world", state));

    expect(results).toEqual([{ isMatch: false, content: "Hello " }]);
    expect(results2).toEqual([
      { isMatch: true, content: "{{name}}", streamIndices: [6, 14] },
      { isMatch: false, content: " worl" }
    ]);
    expect(strategy.flush(state)).toEqual("d");
  });

  it("invalid sequence - content between start and failed end treated as match", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    const results1 = Array.from(strategy.processChunk("{{na", state));
    const results2 = Array.from(strategy.processChunk("me without end", state));
    const flushed = strategy.flush(state);

    expect(results1).toEqual([]);
    expect(results2).toEqual([]);

    // when we don't find the end delimiter, everything is buffered and must be flushed
    expect(flushed).toEqual("{{name without end");
  });

  it("three-token pattern", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy('<img src="'),
      new BufferedIndexOfCancellableSearchStrategy('" alt="'),
      new BufferedIndexOfCancellableSearchStrategy('">')
    ]);
    const state = strategy.createState();

    const results = Array.from(
      strategy.processChunk('<img src="/photo.jpg" alt="sunset"> text', state)
    );
    expect(results).toEqual([
      { isMatch: true, content: '<img src="/photo.jpg" alt="sunset">', streamIndices: [0, 35] }
    ]);
    expect(strategy.flush(state)).toEqual(" text");
  });

  it("flush with incomplete sequence", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    Array.from(strategy.processChunk("{{name", state));
    const flushResults = strategy.flush(state);

    expect(flushResults).toEqual("{{name");
  });

  // ===== Split Delimiter Tests =====

  it("opening delimiter split across chunks", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    const r1 = Array.from(strategy.processChunk("Hello {", state));
    const r2 = Array.from(strategy.processChunk("{name}}", state));

    expect(r1).toEqual([{ isMatch: false, content: "Hello " }]);
    expect(r2).toEqual([{ isMatch: true, content: "{{name}}", streamIndices: [6, 14] }]);
  });

  it("closing delimiter split across chunks", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    const r1 = Array.from(strategy.processChunk("{{name}", state));
    const r2 = Array.from(strategy.processChunk("} world", state));

    expect(r1).toEqual([]);
    expect(r2).toEqual([
      { isMatch: true, content: "{{name}}", streamIndices: [0, 8] },
      { isMatch: false, content: " worl" }
    ]);
    expect(strategy.flush(state)).toEqual("d");
  });

  it("both delimiters split across multiple chunks", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    const r1 = Array.from(strategy.processChunk("{", state));
    const r2 = Array.from(strategy.processChunk("{hel", state));
    const r3 = Array.from(strategy.processChunk("lo}", state));
    const r4 = Array.from(strategy.processChunk("} there", state));

    expect(r1).toEqual([]);
    expect(r2).toEqual([]);
    expect(r3).toEqual([]);
    expect(r4).toEqual([
      { isMatch: true, content: "{{hello}}", streamIndices: [0, 9] },
      { isMatch: false, content: " ther" }
    ]);
    expect(strategy.flush(state)).toEqual("e");
  });

  it("split delimiter that fails to match - first delimiter interrupted", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    // "{" + " {hi}}" = "{ {hi}}" - no valid "{{" because of space
    const r1 = Array.from(strategy.processChunk("{", state));
    const r2 = Array.from(strategy.processChunk(" {hi}}", state));

    // The "{" is buffered by BufferedIndexOfCancellableSearchStrategy, then " " breaks it
    // BufferedIndexOfCancellableSearchStrategy outputs the whole thing as one non-match
    expect(r1).toEqual([]);
    expect(r2).toEqual([{ isMatch: false, content: "{ {hi}" }]);
    expect(strategy.flush(state)).toEqual("}");
  });

  it("partial delimiter followed by complete match", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    const r1 = Array.from(strategy.processChunk("{", state));
    const r2 = Array.from(strategy.processChunk("x {{name}}", state));

    expect(r1).toEqual([]);
    expect(r2).toEqual([
      { isMatch: false, content: "{x " },
      { isMatch: true, content: "{{name}}", streamIndices: [3, 11] }
    ]);
  });

  // ===== Multiple Matches Tests =====

  it("two complete sequences in one chunk", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    const results = Array.from(
      strategy.processChunk("{{first}} {{second}}", state)
    );

    expect(results).toEqual([
      { isMatch: true, content: "{{first}}", streamIndices: [0, 9] },
      { isMatch: false, content: " " },
      { isMatch: true, content: "{{second}}", streamIndices: [10, 20] }
    ]);
  });

  it("two complete sequences across separate chunks", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    const r1 = Array.from(strategy.processChunk("{{first}}", state));
    const r2 = Array.from(strategy.processChunk("{{second}}", state));

    expect(r1).toEqual([{ isMatch: true, content: "{{first}}", streamIndices: [0, 9] }]);
    expect(r2).toEqual([{ isMatch: true, content: "{{second}}", streamIndices: [9, 19] }]);
  });

  it("sequence completes and next begins in same chunk", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    const r1 = Array.from(strategy.processChunk("{{first}}", state));
    const r2 = Array.from(strategy.processChunk(" {{partial", state));

    expect(r1).toEqual([{ isMatch: true, content: "{{first}}", streamIndices: [0, 9] }]);
    expect(r2).toEqual([{ isMatch: false, content: " " }]);

    const r3 = strategy.flush(state);
    expect(r3).toEqual("{{partial");
  });

  it("multiple matches with split delimiters across chunks", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    const r1 = Array.from(strategy.processChunk("{{a}}", state));
    const r2 = Array.from(strategy.processChunk(" {", state));
    const r3 = Array.from(strategy.processChunk("{b}}", state));

    expect(r1).toEqual([{ isMatch: true, content: "{{a}}", streamIndices: [0, 5] }]);
    expect(r2).toEqual([{ isMatch: false, content: " " }]);
    expect(r3).toEqual([{ isMatch: true, content: "{{b}}", streamIndices: [6, 11] }]);
  });

  // ===== Edge Cases =====

  it("empty content between delimiters", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    const results = Array.from(strategy.processChunk("{{}}", state));

    expect(results).toEqual([{ isMatch: true, content: "{{}}", streamIndices: [0, 4] }]);
  });

  it("consecutive sequences with no content between", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    const results = Array.from(strategy.processChunk("{{a}}{{b}}", state));

    expect(results).toEqual([
      { isMatch: true, content: "{{a}}", streamIndices: [0, 5] },
      { isMatch: true, content: "{{b}}", streamIndices: [5, 10] }
    ]);
  });

  it("failed sequence followed by successful sequence", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    const r1 = Array.from(strategy.processChunk("{{incomplete", state));
    const r2 = Array.from(strategy.processChunk(" {{complete}}", state));

    expect(r1).toEqual([]);
    // The first "{{" matches, then accumulates "incomplete {{complete", then finds "}}" - valid match!
    expect(r2).toEqual([{ isMatch: true, content: "{{incomplete {{complete}}", streamIndices: [0, 25] }]);
  });

  it("nested-looking but sequential delimiters", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    // "{{{{" → finds first "{{", then looks for "}}", finds another "{{" which is just content
    const results = Array.from(strategy.processChunk("{{{{stuff}}}}", state));

    // Should match "{{{{stuff}}" as first sequence, then "}}" is non-match
    expect(results).toEqual([
      { isMatch: true, content: "{{{{stuff}}", streamIndices: [0, 11] },
      { isMatch: false, content: "}" }
    ]);
    expect(strategy.flush(state)).toEqual("}");
  });

  it("three-token pattern with split delimiters", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy('<img src="'),
      new BufferedIndexOfCancellableSearchStrategy('" alt="'),
      new BufferedIndexOfCancellableSearchStrategy('">')
    ]);
    const state = strategy.createState();

    const r1 = Array.from(strategy.processChunk("<img src", state));
    const r2 = Array.from(strategy.processChunk('="/photo.jpg"', state));
    const r3 = Array.from(strategy.processChunk(' alt="sunset', state));
    const r4 = Array.from(strategy.processChunk('"> text', state));

    expect(r1).toEqual([]);
    expect(r2).toEqual([]);
    expect(r3).toEqual([]);
    expect(r4).toEqual([
      { isMatch: true, content: '<img src="/photo.jpg" alt="sunset">', streamIndices: [0, 35] }
    ]);
    expect(strategy.flush(state)).toEqual(" text");
  });

  it("multiple three-token sequences", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy('<img src="'),
      new BufferedIndexOfCancellableSearchStrategy('" alt="'),
      new BufferedIndexOfCancellableSearchStrategy('">')
    ]);
    const state = strategy.createState();

    const results = Array.from(
      strategy.processChunk(
        '<img src="a.jpg" alt="first"><img src="b.jpg" alt="second">',
        state
      )
    );

    expect(results).toEqual([
      { isMatch: true, content: '<img src="a.jpg" alt="first">', streamIndices: [0, 29] },
      { isMatch: true, content: '<img src="b.jpg" alt="second">', streamIndices: [29, 59] }
    ]);
  });

  it("very long content between delimiters across many chunks", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    const r1 = Array.from(strategy.processChunk("{{part1", state));
    const r2 = Array.from(strategy.processChunk("part2", state));
    const r3 = Array.from(strategy.processChunk("part3", state));
    const r4 = Array.from(strategy.processChunk("part4}}", state));

    expect(r1).toEqual([]);
    expect(r2).toEqual([]);
    expect(r3).toEqual([]);
    expect(r4).toEqual([{ isMatch: true, content: "{{part1part2part3part4}}", streamIndices: [0, 24] }]);
  });

  it("delimiter appears in content between delimiters", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("{{"),
      new BufferedIndexOfCancellableSearchStrategy("}}")
    ]);
    const state = strategy.createState();

    // After finding "{{", the next "{{" is just content, keep looking for "}}"
    const results = Array.from(
      strategy.processChunk("{{content with {{ inside}}", state)
    );

    expect(results).toEqual([
      { isMatch: true, content: "{{content with {{ inside}}", streamIndices: [0, 26] }
    ]);
  });

  it("single character delimiters with complex splitting", () => {
    const strategy = new AnchorSequenceSearchStrategy([
      new BufferedIndexOfCancellableSearchStrategy("["),
      new BufferedIndexOfCancellableSearchStrategy("]")
    ]);
    const state = strategy.createState();

    const r1 = Array.from(strategy.processChunk("before [mi", state));
    const r2 = Array.from(strategy.processChunk("dd", state));
    const r3 = Array.from(strategy.processChunk("le] after", state));

    expect(r1).toEqual([{ isMatch: false, content: "before " }]);
    expect(r2).toEqual([]);
    expect(r3).toEqual([{ isMatch: true, content: "[middle]", streamIndices: [7, 15] }]);
    expect(strategy.flush(state)).toEqual(" after");
  });
});
