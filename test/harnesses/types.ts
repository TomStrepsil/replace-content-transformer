type ReplacementFunction = (
  match: string,
  index: number
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
