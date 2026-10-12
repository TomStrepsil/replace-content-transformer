import { AsyncSerialReplacementTransformEngine } from "../src/engines/async-serial-transform-engine.ts";
import {
  AsyncLookaheadTransformEngine,
  SemaphoreStrategy
} from "../src/engines/async-lookahead-transform-engine/index.ts";
import { SyncReplacementTransformEngine } from "../src/engines/sync-transform-engine.ts";
import { RegexSearchStrategy } from "../src/search-strategies/regex/index.ts";

function acceptString(value: string): void {
  void value;
}

function assertStreamRegexMatchType() {
  const searchStrategy = new RegexSearchStrategy(/(?<name>\w+)/);

  new SyncReplacementTransformEngine({
    searchStrategy,
    replacement: (match) => {
      // @ts-expect-error Stream matches do not provide the chunk-local RegExp input.
      acceptString(match.input);
      return match.groups?.name ?? "";
    }
  });

  new AsyncSerialReplacementTransformEngine({
    searchStrategy,
    replacement: async (match) => {
      // @ts-expect-error Stream matches do not provide the chunk-local RegExp input.
      acceptString(match.input);
      return match.groups?.name ?? "";
    }
  });

  new AsyncLookaheadTransformEngine({
    searchStrategy,
    replacement: async (match) => {
      // @ts-expect-error Stream matches do not provide the chunk-local RegExp input.
      acceptString(match.input);
      return (async function* () { yield match.groups?.name ?? ""; })();
    },
    concurrencyStrategy: new SemaphoreStrategy(1)
  });
}

void assertStreamRegexMatchType;
