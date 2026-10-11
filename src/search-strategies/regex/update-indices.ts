export default function updateIndices(
  indices: RegExpIndicesArray,
  offset: number
) {
  for (const entry of indices) {
    if (entry === undefined) continue;
    entry[0] += offset;
    entry[1] += offset;
  }
}
