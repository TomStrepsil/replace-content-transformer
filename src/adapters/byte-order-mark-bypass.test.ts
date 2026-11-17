import { describe, it, expect, vi } from "vitest";
import { ByteOrderMarkBypass } from "./byte-order-mark-bypass.js";

describe("ByteOrderMarkBypass", () => {
  it("emits a byte order mark at the start of the first text and returns the text after it", () => {
    const emit = vi.fn();
    const bypass = new ByteOrderMarkBypass(emit);

    expect(bypass.textForEngine("\uFEFFabc")).toBe("abc");
    expect(emit).toHaveBeenCalledOnce();
  });

  it("returns the first text unchanged, emitting nothing, when it does not start with a byte order mark", () => {
    const emit = vi.fn();
    const bypass = new ByteOrderMarkBypass(emit);

    expect(bypass.textForEngine("a\uFEFF")).toBe("a\uFEFF");
    expect(emit).not.toHaveBeenCalled();
  });

  it("returns an empty string for a first text that is only a byte order mark", () => {
    const emit = vi.fn();
    const bypass = new ByteOrderMarkBypass(emit);

    expect(bypass.textForEngine("\uFEFF")).toBe("");
    expect(emit).toHaveBeenCalledOnce();
  });

  it("checks the first non-empty text, after any empty ones", () => {
    const emit = vi.fn();
    const bypass = new ByteOrderMarkBypass(emit);

    expect(bypass.textForEngine("")).toBe("");
    expect(bypass.textForEngine("\uFEFFa")).toBe("a");
    expect(emit).toHaveBeenCalledOnce();
  });

  it("returns a byte order mark at the start of a later text unchanged, as it is not at the start of the input", () => {
    const emit = vi.fn();
    const bypass = new ByteOrderMarkBypass(emit);
    bypass.textForEngine("a");

    expect(bypass.textForEngine("\uFEFFb")).toBe("\uFEFFb");
    expect(emit).not.toHaveBeenCalled();
  });

  it("removes only the first of two byte order marks, as a TextDecoder does", () => {
    const bypass = new ByteOrderMarkBypass(vi.fn());

    expect(bypass.textForEngine("\uFEFF\uFEFFa")).toBe("\uFEFFa");
  });

  it("returns text decoded upstream unchanged, a leading U+FEFF included, emitting nothing", () => {
    const emit = vi.fn();
    const bypass = new ByteOrderMarkBypass(emit);

    expect(bypass.textDecodedUpstream("\uFEFFa")).toBe("\uFEFFa");
    expect(emit).not.toHaveBeenCalled();
  });

  it("returns a byte order mark after text decoded upstream unchanged, as it is not at the start of the input", () => {
    const emit = vi.fn();
    const bypass = new ByteOrderMarkBypass(emit);
    bypass.textDecodedUpstream("a");

    expect(bypass.textForEngine("\uFEFFb")).toBe("\uFEFFb");
    expect(emit).not.toHaveBeenCalled();
  });

  it("checks the first decoded text after empty text decoded upstream", () => {
    const emit = vi.fn();
    const bypass = new ByteOrderMarkBypass(emit);
    bypass.textDecodedUpstream("");

    expect(bypass.textForEngine("\uFEFFa")).toBe("a");
    expect(emit).toHaveBeenCalledOnce();
  });
});
