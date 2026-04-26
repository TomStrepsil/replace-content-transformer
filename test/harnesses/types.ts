import type { ReplacementContext } from "../../src/replacement-processors/replacement-processor.base.ts";

type ReplacementFunction = (
  match: string,
  context: ReplacementContext
) => string | Promise<string>;

export type BaseHarness = {
  name: string;
  isAsync: boolean;
  isStateful?: boolean;
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
