import PartialMatchRegExp from "regex-partial-match";
import inputValidation from "./input-validation.js";

const validate = (needle: RegExp) => inputValidation(new PartialMatchRegExp(needle));

describe("input validation", () => {
  it("should not allow negative lookahead to be part of the needle", () => {
    expect(() => validate(/this (?!is not) allowed/)).toThrow(
      "negative lookaheads are not supported"
    );
  });

  it("should not allow positive lookbehind to be part of the needle", () => {
    expect(() => validate(/this (?<=is not) allowed/)).toThrow(
      "lookbehinds are not supported"
    );
  });

  it("should not allow negative lookbehind to be part of the needle", () => {
    expect(() => validate(/this (?<!is not) allowed/)).toThrow(
      "lookbehinds are not supported"
    );
  });

  it("should allow a character class containing the literal characters of a negative lookahead", () => {
    expect(() => validate(/this [(?!]+ allowed/)).not.toThrow();
  });

  it("should allow a character class containing the literal characters of a lookbehind", () => {
    expect(() => validate(/this [?<=!]+ allowed/)).not.toThrow();
  });

  it("should allow an escaped, literal negative-lookahead-shaped sequence", () => {
    expect(() => validate(/this \(\?!is not\) allowed/)).not.toThrow();
  });

  it("should allow named capturing groups that start with (?<", () => {
    expect(() => validate(/(?<name>foo)/)).not.toThrow();
  });

  it("should allow positive lookaheads", () => {
    expect(() => validate(/foo(?=bar)/)).not.toThrow();
  });

  it("should not allow a word boundary in the needle", () => {
    expect(() => validate(/\bfoo/)).toThrow(
      "word boundaries are not supported"
    );
  });

  it("should not allow a non-word-boundary in the needle", () => {
    expect(() => validate(/foo\B/)).toThrow(
      "word boundaries are not supported"
    );
  });

  it("should allow a backspace character class, which shares \\b's syntax", () => {
    expect(() => validate(/[\b]/)).not.toThrow();
  });

  it("should not allow a start anchor in the needle", () => {
    expect(() => validate(/^foo/)).toThrow(
      "the ^ and $ anchors are not supported"
    );
  });

  it("should not allow an end anchor in the needle", () => {
    expect(() => validate(/foo$/)).toThrow(
      "the ^ and $ anchors are not supported"
    );
  });

  it("should allow a negated character class, which shares ^'s syntax", () => {
    expect(() => validate(/[^abc]/)).not.toThrow();
  });

  it("should allow a character class containing a literal $", () => {
    expect(() => validate(/[a$b]/)).not.toThrow();
  });

  it("should allow escaped, literal anchor characters", () => {
    expect(() => validate(/\^foo\$/)).not.toThrow();
  });

  it("should not allow a ^ that isn't at the start of the pattern", () => {
    expect(() => validate(/foo^bar/)).toThrow(
      "the ^ and $ anchors are not supported"
    );
  });

  it("should not allow a $ that isn't at the end of the pattern", () => {
    expect(() => validate(/foo$bar/)).toThrow(
      "the ^ and $ anchors are not supported"
    );
  });

  it("should not allow a ^ inside an alternation branch, a realistic multiline-style shape", () => {
    expect(() => validate(/foo|^bar/)).toThrow(
      "the ^ and $ anchors are not supported"
    );
  });

  it("should not allow a ^ inside a non-capturing group used as a line-start alternative", () => {
    expect(() => validate(/(?:^|\n)ERROR/)).toThrow(
      "the ^ and $ anchors are not supported"
    );
  });

  it("should not allow the global flag on the needle", () => {
    expect(() => validate(/allowed/g)).toThrow(
      "the global (g) flag is not supported"
    );
  });

  it("should not allow the sticky flag on the needle", () => {
    expect(() => validate(/allowed/y)).toThrow(
      "the sticky (y) flag is not supported"
    );
  });

  it("should not allow the multiline flag on the needle", () => {
    expect(() => validate(/allowed/m)).toThrow(
      "the multiline (m) flag is not supported"
    );
  });

  it("should not allow the global, sticky and multiline flags combined with other flags", () => {
    expect(() => validate(/allowed/gi)).toThrow(
      "the global (g) flag is not supported"
    );
    expect(() => validate(/allowed/iy)).toThrow(
      "the sticky (y) flag is not supported"
    );
    expect(() => validate(/allowed/mi)).toThrow(
      "the multiline (m) flag is not supported"
    );
  });

  it("should allow patterns without global, sticky or multiline flags", () => {
    expect(() => validate(/allowed/disu)).not.toThrow();
  });
});
