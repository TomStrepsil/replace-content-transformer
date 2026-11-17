export const BYTE_ORDER_MARK = "\uFEFF";

export class ByteOrderMarkBypass {
  readonly #onByteOrderMark: () => void;
  #awaitingText = true;

  constructor(onByteOrderMark: () => void) {
    this.#onByteOrderMark = onByteOrderMark;
  }

  textForEngine(decoded: string): string {
    if (!this.#awaitingText || !decoded) return decoded;
    this.#awaitingText = false;
    if (!decoded.startsWith(BYTE_ORDER_MARK)) return decoded;
    this.#onByteOrderMark();
    return decoded.slice(BYTE_ORDER_MARK.length);
  }

  textDecodedUpstream(text: string): string {
    if (text) this.#awaitingText = false;
    return text;
  }
}
