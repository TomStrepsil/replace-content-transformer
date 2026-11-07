import bufferGuard, { validateAtLeast } from "./buffer-guard.js";

describe("bufferGuard", () => {
  it("defaults maxBufferLength to 64 Ki code units", () => {
    expect(bufferGuard().maxBufferLength).toBe(65_536);
    expect(bufferGuard({ maxBufferLength: undefined }).maxBufferLength).toBe(65_536);
  });

  it("keeps the maxBufferLength given", () => {
    expect(bufferGuard({ maxBufferLength: 8 }).maxBufferLength).toBe(8);
  });

  it.each([Number.NaN, -1, null, "100"])("rejects a maxBufferLength of %j", (maxBufferLength) => {
    const guard = () => bufferGuard({ maxBufferLength: maxBufferLength as number });
    expect(guard).toThrow(RangeError);
    expect(guard).toThrow("maxBufferLength");
  });

  it.each([0, 1, 2.5, Infinity])("accepts a maxBufferLength of %j", (maxBufferLength) => {
    expect(() => bufferGuard({ maxBufferLength })).not.toThrow();
  });

  describe("release", () => {
    it("calls onGuardExceeded once, with no arguments, and cuts at the limit from the start given", () => {
      const onGuardExceeded = vi.fn();
      expect(bufferGuard({ maxBufferLength: 3, onGuardExceeded }).release("abcdefg", 2)).toBe(5);
      expect(onGuardExceeded.mock.calls).toEqual([[]]);
    });

    it("needs no onGuardExceeded", () => {
      expect(bufferGuard({ maxBufferLength: 3 }).release("abcdefg", 0)).toBe(3);
    });

    it("releases at least one code point under a limit of zero", () => {
      expect(bufferGuard({ maxBufferLength: 0 }).release("abc", 1)).toBe(2);
      expect(bufferGuard({ maxBufferLength: 0 }).release("😀x", 0)).toBe(2);
    });

    it("never cuts a surrogate pair in two", () => {
      expect(bufferGuard({ maxBufferLength: 2 }).release("a😀b", 0)).toBe(3);
    });
  });
});

describe("validateAtLeast", () => {
  it("names the option, the minimum and the value received", () => {
    expect(() => validateAtLeast("factor", 0.5, 1)).toThrow(
      "factor must be a number of at least 1 (or Infinity), received 0.5"
    );
  });
});
