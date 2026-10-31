import HeldText from "./held-text.js";
import { everySplitOf } from "../../test/splits.js";

describe("HeldText", () => {
  const holding = (anchors: string[], chunks: string[]) => {
    const held = new HeldText(anchors);
    chunks.forEach((chunk) => held.append(chunk));
    return held;
  };

  describe("find", () => {
    it.each([
      [["---"], "a----b---"],
      [["{{", "}}"], "{{a}}b{{{c}}}"],
      [["<esi:include", "/>"], "x<esi:include src='/>'/> <esi:includ"]
    ])(
      "finds every occurrence of %j that indexOf would, as each chunk arrives, at every split",
      (anchors, input) => {
        for (const chunks of everySplitOf(input)) {
          const held = new HeldText(anchors);
          const from = anchors.map(() => 0);
          let received = "";
          for (const chunk of chunks) {
            held.append(chunk);
            received += chunk;
            anchors.forEach((anchor, index) => {
              while(true) {
                const found = held.find(index, from[index]);
                expect(found, chunks.join("|")).toBe(
                  received.indexOf(anchor, from[index])
                );
                if (found === -1) break;
                from[index] = found + 1;
              }
            });
          }
        }
      }
    );

    it("never starts a chunk's search at a negative position, which Uint8Array.prototype.indexOf would count from the end", () => {
      class RecordingHeldText extends HeldText {
        starts: number[] = [];
        protected override search(text: string, anchorIndex: number, from: number) {
          this.starts.push(from);
          return super.search(text, anchorIndex, from);
        }
      }
      for (const chunks of everySplitOf("ab{cd{{ef{g{{")) {
        const held = new RecordingHeldText(["{{"]);
        let from = 0;
        for (const chunk of chunks) {
          held.append(chunk);
          const found = held.find(0, from);
          if (found !== -1) from = found + 1;
        }
        expect(Math.min(...held.starts), chunks.join("|")).toBeGreaterThanOrEqual(0);
      }
    });

    it("finds nothing before the content to contain it has arrived", () => {
      const held = holding(["{{"], ["a{"]);
      expect(held.find(0, 0)).toBe(-1);
      held.append("{");
      expect(held.find(0, 0)).toBe(1);
    });
  });

  describe("take", () => {
    it("returns the text held before a position and stops holding it", () => {
      const held = holding(["{{"], ["ab", "cd", "ef"]);

      expect(held.take(3)).toBe("abc");
      expect(held.takenTo).toBe(3);
      expect(held.take(6)).toBe("def");
      expect(held.takenTo).toBe(held.receivedTo);
    });

    it("still finds anchors after earlier text was taken", () => {
      const held = holding(["{{"], ["a{", "{b", "{{"]);
      held.take(4);

      expect(held.find(0, 4)).toBe(4);
      expect(held.slice(4, 6)).toBe("{{");
    });

    it("still finds and slices once a chunk longer than what is held arrives, after a take part-way through the chunks", () => {
      const held = holding(["{{"], ["abcdef", "g", "h"]);
      held.take(6);
      held.append("i{{jklmn");

      expect(held.find(0, 6)).toBe(9);
      expect(held.slice(6, 16)).toBe("ghi{{jklmn");
    });

    it("stops keeping the text it has handed back, so a long stream held in small pieces needs bounded memory", () => {
      const held = new HeldText(["{{"]);
      const kept = () =>
        (held as unknown as { chunks: string[] }).chunks.join("").length;
      held.append("x".repeat(64));
      let longestKept = 0;
      for (let chunk = 0; chunk < 10_000; chunk++) {
        held.append("y");
        held.take(held.receivedTo - 64);
        longestKept = Math.max(longestKept, kept());
      }

      expect(longestKept).toBeLessThanOrEqual(3 * 64);
    });
  });

  describe("slice", () => {
    it("returns text across chunk boundaries", () => {
      const held = holding(["{{"], ["ab", "c", "def"]);

      expect(held.slice(1, 5)).toBe("bcde");
      expect(held.slice(0, 6)).toBe("abcdef");
      expect(held.slice(3, 3)).toBe("");
    });
  });

  describe("partialAnchorStart", () => {
    it.each([
      ["a tail that could begin the anchor", "{{", ["text {"], 0, 5],
      ["the longest such tail", "aab", ["xaaa"], 0, 2],
      ["the end, when no tail could", "{{", ["text"], 0, 4],
      ["a tail split across chunks", "<esi:include", ["x <esi", ":incl"], 0, 2],
      ["a tail starting no earlier than asked", "aab", ["xaa"], 2, 2]
    ])("finds %s", (_label, anchor, chunks, from, expected) => {
      expect(holding([anchor], chunks).partialAnchorStart(0, from)).toBe(expected);
    });
  });
});
