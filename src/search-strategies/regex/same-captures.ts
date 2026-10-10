export default function sameCaptures(
  candidate: RegExpExecArray,
  confirmed: RegExpExecArray
): boolean {
  return (
    candidate.length === confirmed.length &&
    candidate.every((capture, group) => capture === confirmed[group])
  );
}
