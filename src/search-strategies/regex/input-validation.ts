import type PartialMatchRegExp from "regex-partial-match";
import features, { isPartialMatchRegExp } from "regex-partial-match/features";

const throwUnsupported = (reason: string): never => {
  throw new Error(`${reason} not supported`);
};

const inputValidation = (partialMatchRegex: PartialMatchRegExp) => {
  if (!isPartialMatchRegExp(partialMatchRegex)) {
    throw new TypeError(
      `expected a PartialMatchRegExp instance, received ${String(partialMatchRegex)}`
    );
  }
  const detected = features(partialMatchRegex);
  switch (true) {
    case detected.has("negativeLookahead"):
      return throwUnsupported("negative lookaheads are");
    case detected.has("lookbehind") || detected.has("negativeLookbehind"):
      return throwUnsupported("lookbehinds are");
    case detected.has("wordBoundary") || detected.has("nonWordBoundary"):
      return throwUnsupported("word boundaries are");
    case detected.has("startAnchor") || detected.has("endAnchor"):
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
