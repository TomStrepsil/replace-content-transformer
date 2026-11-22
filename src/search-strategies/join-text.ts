export default function joinText(before: string, after: string): string {
  if (after === "") return before;
  if (before === "") return after;
  return before + after;
}
