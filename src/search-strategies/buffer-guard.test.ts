import bufferGuard, { validateAtLeast } from "./buffer-guard.js";

describe("bufferGuard", () => {
  it("defaults maxBufferLength to 64 Ki code units", () => {
    expect(bufferGuard()).toEqual({ maxBufferLength: 65_536 });
    expect(bufferGuard({ maxBufferLength: undefined })).toEqual({
      maxBufferLength: 65_536
    });
  });

  it("keeps the options given", () => {
    const onGuardExceeded = vi.fn();
    expect(bufferGuard({ maxBufferLength: 8, onGuardExceeded })).toEqual({
      maxBufferLength: 8,
      onGuardExceeded
    });
  });

  it.each([
    [Number.NaN, RangeError],
    [-1, RangeError],
    [null, TypeError],
    ["100", TypeError]
  ])("rejects a maxBufferLength of %j with a %O", (maxBufferLength, error) => {
    const guard = () =>
      bufferGuard({ maxBufferLength: maxBufferLength as number });
    expect(guard).toThrow(error);
    expect(guard).toThrow("maxBufferLength");
  });

  it.each([0, Infinity])("accepts a maxBufferLength of %j", (maxBufferLength) => {
    expect(() => bufferGuard({ maxBufferLength })).not.toThrow();
  });
});

describe("validateAtLeast", () => {
  it("names the option, the minimum and the value received", () => {
    expect(() => validateAtLeast("factor", 0.5, 1)).toThrow(
      "factor must be a number of at least 1 (or Infinity), received 0.5"
    );
  });

  it("names the option and the type received when the value is not a number", () => {
    expect(() => validateAtLeast("factor", "2", 1)).toThrow(
      "factor must be a number, received string"
    );
  });
});
