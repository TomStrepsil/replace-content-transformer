const inputValidation = (needle: RegExp) => {
  if (needle.source.includes("(?!")) {
    throw new Error("negative lookaheads are not supported");
  }
  if (["?<=", "?<!"].some((sequence) => needle.source.includes(sequence))) {
    throw new Error("lookbehinds are not supported");
  }
  if (needle.global) {
    throw new Error(
      "the global (g) flag is not supported: the search strategy already iterates over all matches itself, and RegExp.prototype.exec's stateful lastIndex is not reset between the internal exec() calls this strategy makes, which can silently skip or misclassify matches"
    );
  }
  if (needle.sticky) {
    throw new Error(
      "the sticky (y) flag is not supported: it forces exec() to match only at lastIndex rather than scanning forward, which is incompatible with this strategy's chunk-relative matching"
    );
  }
};

export default inputValidation;
