import { describe, it, expect } from "vitest";
import { LoopedIndexOfAnchoredSearchStrategy } from "./search-strategy.js";
import { searchStrategyFactory } from "../../search-strategy-factory.js";
import { BalancedPairSearchStrategy } from "../balanced-pair/search-strategy.js";
import { collectSearchStrategyResults } from "../../../test/utilities.js";

describe("LoopedIndexOfAnchoredSearchStrategy", () => {
  it("should match single token", () => {
    const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{"]);
    const state = strategy.createState();

    const results = [...strategy.processChunk("before {{ after", state)];
    const flushed = strategy.flush(state);

    expect(results).toEqual([
      { isMatch: false, content: "before " },
      { isMatch: true, content: "{{", streamIndices: [7, 9] },
      { isMatch: false, content: " after" }
    ]);
    expect(flushed).toBe("");
  });

  it("should match anchor sequence in single chunk", () => {
    const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
    const state = strategy.createState();

    const results = [...strategy.processChunk("before {{name}} after", state)];
    const flushed = strategy.flush(state);

    expect(results).toEqual([
      { isMatch: false, content: "before " },
      { isMatch: true, content: "{{name}}", streamIndices: [7, 15] },
      { isMatch: false, content: " after" }
    ]);
    expect(flushed).toBe("");
  });

  it("should handle match split across chunks (start token)", () => {
    const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
    const state = strategy.createState();

    const results = [
      ...strategy.processChunk("before {", state),
      ...strategy.processChunk("{name}}", state),
      { isMatch: false, content: strategy.flush(state) }
    ];

    expect(results).toEqual([
      { isMatch: false, content: "before " },
      { isMatch: true, content: "{{name}}", streamIndices: [7, 15] },
      { isMatch: false, content: "" }
    ]);
  });

  it("should handle match split across chunks (end token)", () => {
    const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
    const state = strategy.createState();

    const results = [
      ...strategy.processChunk("before {{name}", state),
      ...strategy.processChunk("} after", state)
    ];
    const flushed = strategy.flush(state);

    expect(results).toEqual([
      { isMatch: false, content: "before " },
      { isMatch: true, content: "{{name}}", streamIndices: [7, 15] },
      { isMatch: false, content: " after" }
    ]);
    expect(flushed).toBe("");
  });

  it("should handle no matches with smart buffering", () => {
    const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
    const state = strategy.createState();

    const results = [
      ...strategy.processChunk("no matches here", state),
      ...strategy.processChunk("or here either", state),
      { isMatch: false, content: strategy.flush(state) }
    ];

    expect(results).toEqual([
      { isMatch: false, content: "no matches here" },
      { isMatch: false, content: "or here either" },
      { isMatch: false, content: "" }
    ]);
  });

  it("should avoid unnecessary buffering when no partial match", () => {
    const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
    const state = strategy.createState();

    // Process first chunk - ends with 'a', not '{', so no buffering
    const results1 = [...strategy.processChunk("chunk ends with a", state)];
    expect(state.buffer).toBe("");
    expect(results1).toEqual([{ isMatch: false, content: "chunk ends with a" }]);

    // Process second chunk - no buffered content to prepend
    const results2 = [...strategy.processChunk("another chunk", state)];
    expect(results2).toEqual([{ isMatch: false, content: "another chunk" }]);
  });

  it("should buffer when partial match detected", () => {
    const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
    const state = strategy.createState();

    // Process chunk ending with partial match
    const results1 = [...strategy.processChunk("text ends with {", state)];
    expect(state.buffer).toBe("{");
    expect(results1).toEqual([{ isMatch: false, content: "text ends with " }]);

    // Complete the match
    const results2 = [...strategy.processChunk("{name}}", state)];
    expect(results2).toEqual([{ isMatch: true, content: "{{name}}", streamIndices: [15, 23] }]);
  });

  it("should handle false starts", () => {
    const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
    const state = strategy.createState();

    const results = [
      ...strategy.processChunk("text {", state),
      ...strategy.processChunk("x {{match}}", state),
      { isMatch: false, content: strategy.flush(state) }
    ];

    expect(results).toEqual([
      { isMatch: false, content: "text " },
      { isMatch: false, content: "{x " },
      { isMatch: true, content: "{{match}}", streamIndices: [8, 17] },
      { isMatch: false, content: "" }
    ]);
  });

  it("should handle multiple consecutive matches", () => {
    const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
    const state = strategy.createState();

    const results = [
      ...strategy.processChunk("{{first}}{{second}}{{third}}", state),
      { isMatch: false, content: strategy.flush(state) }
    ];

    expect(results).toEqual([
      { isMatch: true, content: "{{first}}", streamIndices: [0, 9] },
      { isMatch: true, content: "{{second}}", streamIndices: [9, 19] },
      { isMatch: true, content: "{{third}}", streamIndices: [19, 28] },
      { isMatch: false, content: "" }
    ]);
  });

  it("should handle three-token anchor sequence", () => {
    const strategy = new LoopedIndexOfAnchoredSearchStrategy([
      "<",
      "{{",
      "}}",
      ">"
    ]);
    const state = strategy.createState();

    const results = [
      ...strategy.processChunk("before <{{name}}> after", state)
    ];
    const flushed = strategy.flush(state);

    expect(results).toEqual([
      { isMatch: false, content: "before " },
      { isMatch: true, content: "<{{name}}>", streamIndices: [7, 17] },
      { isMatch: false, content: " after" }
    ]);
    expect(flushed).toBe("");
  });

  it("should handle incomplete match at end", () => {
    const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
    const state = strategy.createState();

    const results = [
      ...strategy.processChunk("{{incomplete", state),
      { isMatch: false, content: strategy.flush(state) }
    ];

    expect(results).toEqual([{ isMatch: false, content: "{{incomplete" }]);
  });

  describe("cancellation scenarios", () => {
    // Helper to extract the string value from a MatchResult
    const getValue = (result: { isMatch: false, content: string } | { isMatch: true, content: string }): string =>
      result.content;

    it("flushes buffer when cancelling with no matches and no partial match", () => {
      const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      const outputs: string[] = [];

      let generator = strategy.processChunk("Text with no match", state);
      const result = generator.next();
      outputs.push(getValue(result.value!));

      // Generator returns after yielding because no partial match found
      expect(result.done).toBe(false);

      generator.return();

      // No partial match, buffer is empty
      expect(strategy.flush(state)).toBe("");
    });

    it("flushes buffer when cancelling with detected partial match", () => {
      const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      const outputs: string[] = [];

      let generator = strategy.processChunk("Text ends with {", state);
      const result = generator.next();
      outputs.push(getValue(result.value!));

      // Generator returns after yielding and setting buffer to "{"
      expect(result.done).toBe(false);

      generator.return();

      // Smart buffering detected "{" as partial match
      expect(strategy.flush(state)).toBe("{");
    });

    it("flushes buffer when cancelling mid-match (after finding first needle)", () => {
      const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      let generator = strategy.processChunk("Text {{ something", state);
      const result = generator.next(); // Yields "Text "
      expect(getValue(result.value!)).toBe("Text ");
      expect(result.done).toBe(false);

      // Check if there's another yield before returning
      const result2 = generator.next();
      if (!result2.done) {
        // There was another yield, consume it
        expect(result2.done).toBe(true); // Should be done after this
      }

      // At this point, generator returned naturally after setting buffer in finally
      // Mid-match (currentNeedleIndex = 1): buffer from matchStartPosition
      expect(state.currentNeedleIndex).toBe(1);
      expect(strategy.flush(state)).toBe("{{ something");
    });

    it("flushes buffer when cancelling after complete match before processing remaining content", () => {
      const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      let generator = strategy.processChunk("Text {{ match }} and more", state);
      generator.next(); // "Text "
      generator.next(); // "{{ match }}"
      generator.return(); // Cancel before yielding " and more"

      // Generator was cancelled after match
      // Unprocessed content (" and more") should be buffered
      expect(strategy.flush(state)).toBe(" and more");
    });

    it("flushes buffer when cancelling after first match with more matches remaining", () => {
      const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      let generator = strategy.processChunk(
        "{{ first }} and {{ second }}",
        state
      );
      generator.next(); // "{{ first }}"
      generator.return(); // Cancel before processing " and {{ second }}"

      // Generator was cancelled, unprocessed content should be buffered
      expect(strategy.flush(state)).toBe(" and {{ second }}");
    });

    it("flushes buffer when cancelling with partial match after complete match", () => {
      const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      let generator = strategy.processChunk("{{ match }} ends {", state);
      generator.next(); // "{{ match }}"
      generator.next(); // " ends "
      generator.return();

      // Smart buffering detected "{" as partial match
      expect(strategy.flush(state)).toBe("{");
    });

    it("handles cancellation with three-needle sequence mid-match continuing into next chunk", () => {
      const strategy = new LoopedIndexOfAnchoredSearchStrategy([
        "{{",
        "}}",
        "!"
      ]);
      const state = strategy.createState();

      // First chunk finds {{ and }}, but not ! yet - leaves us mid-match
      const generator1 = strategy.processChunk("text {{ }}", state);
      generator1.next(); // "text "
      const result = generator1.next();
      expect(result.done).toBe(true); // No more yields, still looking for "!"

      // State should be mid-match (currentNeedleIndex = 2)
      expect(state.currentNeedleIndex).toBe(2);
      expect(state.buffer).toBe("{{ }}");

      // Now cancel before processing next chunk
      // The buffered mid-match content should be in the buffer
      expect(strategy.flush(state)).toBe("{{ }}");
    });

    it("handles cancellation when generator completes naturally", () => {
      const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      // Let generator complete naturally
      const generator = strategy.processChunk("text", state);
      const result = generator.next();
      expect(getValue(result.value!)).toBe("text");
      expect(result.done).toBe(false);

      // No more yields, generator is done
      const finalResult = generator.next();
      expect(finalResult.done).toBe(true);

      // No buffer since no partial match
      expect(strategy.flush(state)).toBe("");
    });

    it("handles cancellation when partial match is multiple characters", () => {
      const strategy = new LoopedIndexOfAnchoredSearchStrategy([
        "START",
        "END"
      ]);
      const state = strategy.createState();

      // Chunk ends with "STA" - partial match for "START"
      const generator = strategy.processChunk("text STA", state);
      generator.next(); // "text "
      generator.return();

      // "STA" should be buffered as partial match
      expect(strategy.flush(state)).toBe("STA");
    });

    it("handles cancellation before second yield when mid-match", () => {
      const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      // Simulate mid-match continuation from previous chunk
      state.buffer = "{{";
      state.currentNeedleIndex = 1;

      // This chunk continues the match but gets cancelled before completion
      let generator = strategy.processChunk("middle", state);
      const result = generator.next();
      expect(result.done).toBe(true); // No yield, still looking for "}}"

      generator.return();

      // Should buffer from match start
      expect(strategy.flush(state)).toBe("{{middle");
    });

    it("handles cancellation with no partial match after complete match", () => {
      const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      let generator = strategy.processChunk("{{ complete }} xyz", state);
      generator.next(); // "{{ complete }}"
      generator.next(); // " xyz" (no partial match with "{{")
      generator.return();

      // "xyz" doesn't match any prefix of "{{", so buffer is empty
      expect(strategy.flush(state)).toBe("");
    });

    it("handles cancellation during partial match check with long partial", () => {
      const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{{{", "}}"]);
      const state = strategy.createState();

      // Chunk ends with "{{{" - matches 3-char prefix of "{{{{"
      let generator = strategy.processChunk("test {{{", state);
      generator.next(); // "test "
      generator.return();

      // Should buffer "{{{"
      expect(strategy.flush(state)).toBe("{{{");
    });
  });

  describe("stream offset tracking", () => {
    it("should track correct indices across chunk boundaries", () => {
      const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      const results1 = [...strategy.processChunk("prefix {", state)];
      const results2 = [...strategy.processChunk("{content}}", state)];
      const results = [...results1, ...results2];

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({
        streamIndices: [7, 18]
      });
    });

    it("should track indices across multiple chunks with no matches initially", () => {
      const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      const results1 = [...strategy.processChunk("chunk1 no matches ", state)];
      const results2 = [...strategy.processChunk("chunk2 {{match}} end", state)];
      const results = [...results1, ...results2];

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({
        streamIndices: [25, 34]
      });
    });

    it("should reset offset on createState", () => {
      const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
 
      const state1 = strategy.createState();
      const [match1] = [...strategy.processChunk("{{m1}}", state1)];
      expect(match1).toMatchObject({ streamIndices: [0, 6] });

      const state2 = strategy.createState();
      const [match2] = [...strategy.processChunk("{{m2}}", state2)];
      expect(match2).toMatchObject({ streamIndices: [0, 6] });
    });

    it("should reset streamOffset on flush for state reuse", () => {
      const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      // Stream 1
      const results1 = [...strategy.processChunk("text {{m1}}", state)];
      strategy.flush(state);
      const match1 = results1.find((r) => r.isMatch);
      expect(match1).toMatchObject({ streamIndices: [5, 11] });

      // Stream 2: reuse state after flush — indices should start from 0 again
      const results2 = [...strategy.processChunk("text {{m2}}", state)];
      strategy.flush(state);
      const match2 = results2.find((r) => r.isMatch);
      expect(match2).toMatchObject({ streamIndices: [5, 11] });
    });

    it("should handle indices correctly with buffered partial matches", () => {
      const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();

      // First chunk ends with partial match
      const results1 = [...strategy.processChunk("text {", state)];
      // Second chunk completes and continues
      const results2 = [...strategy.processChunk("{done}} after", state)];
      const results = [...results1, ...results2];

      const match = results.find((r) => r.isMatch);
      expect(match).toMatchObject({
        streamIndices: [5, 13]
      });
    });
  });

  describe("matchToString", () => {
    it("returns the matched string unchanged", () => {
      const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{", "}}"]);
      const state = strategy.createState();
      const results = [...strategy.processChunk("before {{token}} after", state)];
      const match = results.find((r) => r.isMatch)!;
      expect(strategy.matchToString(match.content)).toBe("{{token}}");
    });
  });

  describe("needle validation", () => {
    const emptyNeedleCases: [label: string, needles: string[], index: number][] = [
      ["a lone empty anchor, which would otherwise loop forever", [""], 0],
      ["every anchor empty, which would otherwise loop forever", ["", ""], 0],
      ["a leading empty anchor, which would otherwise swallow the stream", ["", "a"], 0],
      ["a trailing empty anchor, which terminates today but is equally a mistake", ["a", ""], 1]
    ];

    it.each(emptyNeedleCases)(
      "rejects %s",
      (_label, needles, index) => {
        expect(() => new LoopedIndexOfAnchoredSearchStrategy(needles)).toThrow(
          `empty anchors are not supported (index ${index})`
        );
      }
    );

    it("rejects an empty anchor list, which would otherwise fail with an unrelated TypeError on first use", () => {
      expect(() => new LoopedIndexOfAnchoredSearchStrategy([])).toThrow(
        "at least one anchor is required"
      );
    });

    it.each([[["a"]], [["{{", "}}"]], [["a", "b", "c"]]])(
      "accepts %s",
      (needles) => {
        expect(() => new LoopedIndexOfAnchoredSearchStrategy(needles)).not.toThrow();
      }
    );

    it("rejects an empty needle through searchStrategyFactory, the entry point the bug was reported against", () => {
      expect(() => searchStrategyFactory("")).toThrow(
        "empty anchors are not supported (index 0)"
      );
      expect(() => searchStrategyFactory(["", ""])).toThrow(
        "empty anchors are not supported (index 0)"
      );
    });

    it("rejects empty delimiters through BalancedPairSearchStrategy, which delegates its pair to this strategy", () => {
      expect(() => new BalancedPairSearchStrategy("", "")).toThrow(
        "empty anchors are not supported (index 0)"
      );
      expect(() => new BalancedPairSearchStrategy("{", "")).toThrow(
        "empty anchors are not supported (index 1)"
      );
      expect(() => new BalancedPairSearchStrategy("{", "}")).not.toThrow();
    });

    it("copies the needle list, so mutating the caller's array cannot reintroduce an empty anchor", () => {
      const needles = ["a"];
      const strategy = new LoopedIndexOfAnchoredSearchStrategy(needles);
      needles[0] = "";

      const state = strategy.createState();
      const results = [];
      for (const result of strategy.processChunk("xyz", state)) {
        results.push(result);
        if (results.length > 100) throw new Error("processChunk did not advance");
      }

      expect(results).toEqual([{ isMatch: false, content: "xyz" }]);
    });
  });

  describe("bordered anchors at a chunk boundary", () => {
    const run = (needles: string[], chunks: string[]) =>
      collectSearchStrategyResults(
        new LoopedIndexOfAnchoredSearchStrategy(needles),
        chunks
      );

    it.each([
      [
        "the shortest bordered anchor, whose leftover is one character",
        ["---"],
        ["----"],
        [{ isMatch: true, content: "---", streamIndices: [0, 3] }],
        "-"
      ],
      [
        "the same input split, which must agree with the unsplit result",
        ["---"],
        ["--", "--"],
        [{ isMatch: true, content: "---", streamIndices: [0, 3] }],
        "-"
      ],
      [
        "a longer border, where two characters would otherwise repeat",
        ["----"],
        ["-----"],
        [{ isMatch: true, content: "----", streamIndices: [0, 4] }],
        "-"
      ],
      [
        "an anchor sequence, whose match ends in the bordered first anchor",
        ["---", "---"],
        ["---a----"],
        [{ isMatch: true, content: "---a---", streamIndices: [0, 7] }],
        "-"
      ],
      [
        "a border reaching back through the closing anchor of a pair",
        ["aba", "za"],
        ["abaXzab"],
        [
          { isMatch: true, content: "abaXza", streamIndices: [0, 6] },
          { isMatch: false, content: "b" }
        ],
        ""
      ],
      [
        "a leftover long enough for the border, which must still buffer it",
        ["---"],
        ["--- --"],
        [
          { isMatch: true, content: "---", streamIndices: [0, 3] },
          { isMatch: false, content: " " }
        ],
        "--"
      ]
    ])(
      "reports each character once with %s",
      (_label, needles, chunks, results, flush) => {
        const actual = run(needles, chunks);

        expect(actual.results).toEqual(results);
        expect(actual.flush).toBe(flush);
        expect(actual.output).toBe(chunks.join(""));
      }
    );

    it("does not invent an overlapping match when duplicated characters are re-scanned", () => {
      const unsplit = run(["aba"], ["ababa"]);

      expect(run(["aba"], ["abab", "a"])).toEqual(unsplit);
      expect(unsplit.results).toEqual([
        { isMatch: true, content: "aba", streamIndices: [0, 3] },
        { isMatch: false, content: "b" }
      ]);
      expect(unsplit.flush).toBe("a");
    });

    it("inherits the fix in BalancedPairSearchStrategy, which delegates to this strategy", () => {
      const { results, flush, output } = collectSearchStrategyResults(
        new BalancedPairSearchStrategy("***", "**"),
        ["***bold***"]
      );

      expect(results).toEqual([
        { isMatch: true, content: "***bold**", streamIndices: [0, 9] }
      ]);
      expect(flush).toBe("*");
      expect(output).toBe("***bold***");
    });
  });

});
