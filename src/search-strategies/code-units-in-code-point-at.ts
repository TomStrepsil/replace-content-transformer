const MAX_SINGLE_CODE_UNIT_CODE_POINT = 0xffff;

export default function codeUnitsInCodePointAt(haystack: string, position: number): number {
  return haystack.codePointAt(position)! > MAX_SINGLE_CODE_UNIT_CODE_POINT ? 2 : 1;
}
