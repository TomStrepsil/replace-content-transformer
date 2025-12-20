import inputValidation from "./input-validation";

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

  it("should not allow indices flag to be set", () => {
    expect(() => inputValidation(/test/d)).toThrow(
      "expressions with 'd' (indices) flag are not supported"
    );
  });

  it("should not allow backreferences to be used", () => {
    expect(() => inputValidation(/(.)\1/)).toThrow(
      "backreferences are not supported"
    );
    expect(() => inputValidation(/(?<foo>.)\k<foo>/)).toThrow(
      "backreferences are not supported"
    );
  });
});
