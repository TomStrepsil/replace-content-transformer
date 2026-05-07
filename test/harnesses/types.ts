import type { ReplacementContext } from "../../src/engines/types.ts";

type ReplacementFunction = (
  match: string,
  context: ReplacementContext
) => string | Promise<string>;

export type BaseHarness = {
  name: string;
  isAsync: boolean;
  createSearchStrategy: (params: {
    tokens: string[];
    replacement?: ReplacementFunction;
  }) => unknown;
  createTransformer: (params: {
    strategy: unknown;
    replacement?: ReplacementFunction;
  }) => {
    transform: (chunk: string, controller: unknown) => void | Promise<void>;
    flush: (controller: unknown) => void;
  };
};
