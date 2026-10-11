export default function validateNeedles(needles: string[]): void {
  if (needles.length === 0) {
    throw new Error("at least one anchor is required");
  }

  const emptyNeedleIndex = needles.indexOf("");
  if (emptyNeedleIndex !== -1) {
    throw new Error(`empty anchors are not supported (index ${emptyNeedleIndex})`);
  }
}
