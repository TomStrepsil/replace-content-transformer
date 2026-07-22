import inputValidation from "./input-validation.js";

describe("input validation", () => {
  it("should not allow negative lookahead to be part of the needle", () => {
    expect(() => inputValidation(/this (?!is not) allowed/)).toThrow(
      "negative lookaheads are not supported"
    );
  });

  it("should not allow positive lookbehind to be part of the needle", () => {
    expect(() => inputValidation(/this (?<=is not) allowed/)).toThrow(
      "lookbehinds are not supported"
    );
  });

  it("should not allow negative lookbehind to be part of the needle", () => {
    expect(() => inputValidation(/this (?<!is not) allowed/)).toThrow(
      "lookbehinds are not supported"
    );
  });

});
