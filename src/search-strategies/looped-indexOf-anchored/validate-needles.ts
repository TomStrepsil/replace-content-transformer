const MOST_NEEDLES = 64;

export default function validateNeedles(needles: string[]): void {
  if (needles.length === 0) {
    throw new Error("at least one needle/anchor is required");
  }

  if (needles.length > MOST_NEEDLES) {
    throw new Error(`at most ${MOST_NEEDLES} needles/anchors are supported, received ${needles.length}`);
  }

  const emptyNeedleIndex = needles.indexOf("");
  if (emptyNeedleIndex !== -1) {
    throw new Error(`empty needles/anchors are not supported (index ${emptyNeedleIndex})`);
  }
}
