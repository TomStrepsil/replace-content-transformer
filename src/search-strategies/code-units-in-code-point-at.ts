const MAX_SINGLE_CODE_UNIT_CODE_POINT = 0xffff;

export default function codeUnitsInCodePointAt(haystack: string, position: number): number {
  const codePoint = haystack.codePointAt(position) ?? 0;
  return codePoint > MAX_SINGLE_CODE_UNIT_CODE_POINT ? 2 : 1;
}
