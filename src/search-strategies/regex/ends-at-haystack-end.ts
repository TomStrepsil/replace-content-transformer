export default function endsAtHaystackEnd(
  match: RegExpExecArray,
  haystack: string
): boolean {
  return match.index + match[0].length === haystack.length;
}
