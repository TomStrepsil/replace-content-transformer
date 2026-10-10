export default function partialMatchLength(
  haystack: string,
  needle: string,
  unreportedLength: number
): number {
  let partialLength = Math.min(needle.length - 1, unreportedLength);
  while (
    partialLength >= 1 &&
    !haystack.endsWith(needle.slice(0, partialLength))
  ) {
    partialLength--;
  }
  return partialLength;
}
