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

  it("should not allow the global flag on the needle", () => {
    expect(() => inputValidation(/allowed/g)).toThrow(
      "the global (g) flag is not supported"
    );
  });

  it("should not allow the sticky flag on the needle", () => {
    expect(() => inputValidation(/allowed/y)).toThrow(
      "the sticky (y) flag is not supported"
    );
  });

  it("should not allow the global and sticky flags combined with other flags", () => {
    expect(() => inputValidation(/allowed/gi)).toThrow(
      "the global (g) flag is not supported"
    );
    expect(() => inputValidation(/allowed/yi)).toThrow(
      "the sticky (y) flag is not supported"
    );
  });

  it("should allow patterns without global or sticky flags", () => {
    expect(() => inputValidation(/allowed/imsud)).not.toThrow();
  });

});
