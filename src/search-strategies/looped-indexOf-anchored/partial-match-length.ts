const LONGEST_WINDOW_TO_SCAN = 3;

function matchesToEnd(haystack: string, needle: string, start: number): boolean {
  const length = haystack.length;
  let at = start + 1;
  while (at < length && haystack.charCodeAt(at) === needle.charCodeAt(at - start)) at++;
  return at === length;
}

export default function partialMatchLength(
  haystack: string,
  needle: string,
  unreportedLength: number
): number {
  const length = haystack.length;
  const window = Math.min(needle.length - 1, unreportedLength);
  if (window <= LONGEST_WINDOW_TO_SCAN) {
    const firstCode = needle.charCodeAt(0);
    for (let start = length - window; start < length; start++) {
      if (haystack.charCodeAt(start) === firstCode && matchesToEnd(haystack, needle, start)) {
        return length - start;
      }
    }
    return 0;
  }
  const firstCharacter = needle[0];
  for (
    let start = haystack.indexOf(firstCharacter, length - window);
    start !== -1;
    start = haystack.indexOf(firstCharacter, start + 1)
  ) {
    if (matchesToEnd(haystack, needle, start)) return length - start;
  }
  return 0;
}
