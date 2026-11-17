import { BYTE_ORDER_MARK } from "../byte-order-mark.ts";
import type { ByteEngineSink, EngineSink, Utf8Bytes } from "./types.ts";

const continueAcrossPieces = { stream: true } as const;
const byteOrderMark = new TextEncoder().encode(BYTE_ORDER_MARK);
const noBytes = new Uint8Array(0);
const lastAsciiByte = 0x7f;
const firstLeadByte = 0xc0;
const firstLeadOfThreeBytes = 0xe0;
const firstLeadOfFourBytes = 0xf0;
const longestIncompleteCharacter = 3;

type PieceSink = Pick<EngineSink, "enqueue" | "acceptsBytes">;
type BytePieceSink = Pick<ByteEngineSink, "enqueue" | "acceptsBytes">;

export function isUtf8Bytes(value: unknown): value is Utf8Bytes {
  return (
    value instanceof Uint8Array ||
    (ArrayBuffer.isView(value) && (value as Utf8Bytes)[Symbol.toStringTag] === "Uint8Array")
  );
}

export function acceptsBytes<TSink extends PieceSink>(
  sink: TSink
): sink is TSink & BytePieceSink {
  return sink.acceptsBytes === true;
}

function decodable(bytes: Utf8Bytes): Utf8Bytes {
  const { buffer } = bytes;
  return buffer[Symbol.toStringTag] === "ArrayBuffer" && !(buffer as ArrayBuffer).resizable
    ? bytes
    : new Uint8Array(bytes);
}

type Utf8Check = (bytes: Utf8Bytes) => boolean;
type BuiltinModules = { getBuiltinModule?(id: string): { isUtf8?: Utf8Check } | undefined };

const nativeIsUtf8 = (globalThis as { process?: BuiltinModules }).process?.getBuiltinModule?.(
  "node:buffer"
)?.isUtf8;
const strictDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const heldBytesDecoder = new TextDecoder("utf-8", { ignoreBOM: true });

const isUtf8: Utf8Check =
  nativeIsUtf8 ??
  ((bytes) => {
    try {
      strictDecoder.decode(decodable(bytes));
      return true;
    } catch {
      return false;
    }
  });

function textOf(piece: unknown): string {
  return piece == null ? "" : String(piece);
}

function withoutByteOrderMark(bytes: Utf8Bytes): Utf8Bytes {
  return bytes[0] === byteOrderMark[0] && bytes[1] === byteOrderMark[1] && bytes[2] === byteOrderMark[2]
    ? bytes.subarray(byteOrderMark.length)
    : bytes;
}

function joined(first: Utf8Bytes, second: Utf8Bytes): Utf8Bytes {
  const bytes = new Uint8Array(first.byteLength + second.byteLength);
  bytes.set(first);
  bytes.set(second, first.byteLength);
  return bytes;
}

function characterLength(leadByte: number): number {
  if (leadByte >= firstLeadOfFourBytes) return 4;
  return leadByte >= firstLeadOfThreeBytes ? 3 : 2;
}

function wholeCharactersLength(bytes: Utf8Bytes): number {
  const { length } = bytes;
  const earliest = Math.max(0, length - longestIncompleteCharacter);
  for (let index = length - 1; index >= earliest; index--) {
    const byte = bytes[index];
    if (byte <= lastAsciiByte) return length;
    if (byte >= firstLeadByte) return index + characterLength(byte) > length ? index : length;
  }
  return length;
}

export interface ReplacementPieceForwarder {
  piece(piece: string | Utf8Bytes): void;
  end(): void;
}

export class ReplacementPieceDecoder {
  readonly #keepsByteOrderMark: boolean;
  #decoder: TextDecoder | undefined;
  #decoding = false;
  #runStarting = true;

  constructor({ ignoreBOM = false } = {}) {
    this.#keepsByteOrderMark = ignoreBOM;
  }

  get decoding(): boolean {
    return this.#decoding;
  }

  decode(piece: string | Utf8Bytes): string {
    if (!isUtf8Bytes(piece)) {
      const text = textOf(piece);
      return text && this.end() + text;
    }
    this.#decoding = true;
    this.#decoder ??= new TextDecoder("utf-8", { ignoreBOM: true });
    return this.#withoutLeadingByteOrderMark(this.#decoder.decode(decodable(piece), continueAcrossPieces));
  }

  end(): string {
    if (!this.#decoding) return "";
    this.#decoding = false;
    const text = this.#withoutLeadingByteOrderMark(this.#decoder!.decode());
    this.#runStarting = true;
    return text;
  }

  #withoutLeadingByteOrderMark(text: string): string {
    if (!this.#runStarting || !text) return text;
    this.#runStarting = false;
    return !this.#keepsByteOrderMark && text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;
  }
}

class TextPieceForwarder implements ReplacementPieceForwarder {
  readonly #sink: PieceSink;
  readonly #decoder = new ReplacementPieceDecoder();

  constructor(sink: PieceSink) {
    this.#sink = sink;
  }

  piece(piece: string | Utf8Bytes): void {
    this.#enqueue(this.#decoder.decode(piece));
  }

  end(): void {
    this.#enqueue(this.#decoder.end());
  }

  #enqueue(text: string): void {
    if (text) this.#sink.enqueue(text);
  }
}

class BytePieceForwarder implements ReplacementPieceForwarder {
  readonly #sink: BytePieceSink;
  readonly #malformedRun = new ReplacementPieceDecoder({ ignoreBOM: true });
  #held: Utf8Bytes = noBytes;
  #runStarting = true;

  constructor(sink: BytePieceSink) {
    this.#sink = sink;
  }

  piece(piece: string | Utf8Bytes): void {
    if (!isUtf8Bytes(piece)) {
      const text = textOf(piece);
      if (text) this.#sink.enqueue(this.#endRun() + text);
      return;
    }
    if (this.#malformedRun.decoding) {
      this.#enqueueText(this.#malformedRun.decode(piece));
      return;
    }
    let bytes = this.#held.byteLength === 0 ? piece : joined(this.#held, piece);
    if (this.#runStarting && wholeCharactersLength(bytes) !== 0) {
      this.#runStarting = false;
      bytes = withoutByteOrderMark(bytes);
    }
    const length = wholeCharactersLength(bytes);
    const whole = length === bytes.byteLength ? bytes : bytes.subarray(0, length);
    if (!isUtf8(whole)) {
      this.#held = noBytes;
      this.#enqueueText(this.#malformedRun.decode(bytes));
      return;
    }
    this.#held = length === bytes.byteLength ? noBytes : new Uint8Array(bytes.subarray(length));
    if (length !== 0) this.#sink.enqueue(whole);
  }

  end(): void {
    this.#enqueueText(this.#endRun());
  }

  #endRun(): string {
    const text = this.#malformedRun.end() + heldBytesDecoder.decode(this.#held);
    this.#held = noBytes;
    this.#runStarting = true;
    return text;
  }

  #enqueueText(text: string): void {
    if (text) this.#sink.enqueue(text);
  }
}

export function replacementPieceForwarder(sink: PieceSink): ReplacementPieceForwarder {
  return acceptsBytes(sink) ? new BytePieceForwarder(sink) : new TextPieceForwarder(sink);
}
