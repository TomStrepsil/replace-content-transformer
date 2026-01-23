import { describe, it, expect } from "vitest";
import { LoopedIndexOfAnchoredSearchStrategy } from "./search-strategy.ts";

describe("LoopedIndexOfAnchoredSearchStrategy", () => {
  it("should match single token", () => {
    const strategy = new LoopedIndexOfAnchoredSearchStrategy(["{{"]);
    const state = strategy.createState();

    const results = [...strategy.processChunk("before {{ after", state)];
    const flushed = strategy.flush(state);

    expect(results).toEqual([
      { isMatch: false, content: "before " },
      { isMatch: true, content: "{{" },
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
      { isMatch: true, content: "{{name}}" },
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
      { isMatch: true, content: "{{name}}" },
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
      { isMatch: true, content: "{{name}}" },
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
    expect(results2).toEqual([{ isMatch: true, content: "{{name}}" }]);
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
      { isMatch: true, content: "{{match}}" },
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
      { isMatch: true, content: "{{first}}" },
      { isMatch: true, content: "{{second}}" },
      { isMatch: true, content: "{{third}}" },
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
      { isMatch: true, content: "<{{name}}>" },
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
});
