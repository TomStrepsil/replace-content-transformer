import type PartialMatchRegExp from "regex-partial-match";

const throwUnsupported = (reason: string): never => {
  throw new Error(`${reason} not supported`);
};

const inputValidation = (partialMatchRegex: PartialMatchRegExp) => {
  const { features } = partialMatchRegex;
  switch (true) {
    case features.has("negativeLookahead"):
      return throwUnsupported("negative lookaheads are");
    case features.has("lookbehind") || features.has("negativeLookbehind"):
      return throwUnsupported("lookbehinds are");
    case features.has("wordBoundary") || features.has("nonWordBoundary"):
      return throwUnsupported("word boundaries are");
    case features.has("startAnchor") || features.has("endAnchor"):
      return throwUnsupported("the ^ and $ anchors are");
    case partialMatchRegex.global:
      return throwUnsupported("the global (g) flag is");
    case partialMatchRegex.sticky:
      return throwUnsupported("the sticky (y) flag is");
    case partialMatchRegex.multiline:
      return throwUnsupported("the multiline (m) flag is");
  }
};

export default inputValidation;
