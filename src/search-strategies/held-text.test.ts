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
              for (;;) {
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
      expect(held.start).toBe(3);
      expect(held.take(6)).toBe("def");
      expect(held.start).toBe(held.end);
    });

    it("still finds anchors after earlier text was taken", () => {
      const held = holding(["{{"], ["a{", "{b", "{{"]);
      held.take(4);

      expect(held.find(0, 4)).toBe(4);
      expect(held.slice(4, 6)).toBe("{{");
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
