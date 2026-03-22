const inputValidation = (needle: RegExp) => {
  if (needle.source.includes("(?!")) {
    throw new Error("negative lookaheads are not supported");
  }
  if (["?<=", "?<!"].some((sequence) => needle.source.includes(sequence))) {
    throw new Error("lookbehinds are not supported");
  }
  if (needle.source.match(/\\[\dk]/)) {
    throw new Error("backreferences are not supported");
  }
};

export default inputValidation;
