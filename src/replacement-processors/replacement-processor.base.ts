import type { SearchStrategy } from "../search-strategies/types";

export type ReplacementProcessorOptions<T> = {
  searchStrategy: SearchStrategy<T>;
};

export abstract class ReplacementProcessorBase<T> {
  protected readonly searchStrategy: SearchStrategy<T>;
  protected searchState: T;

  constructor({ searchStrategy }: ReplacementProcessorOptions<T>) {
    this.searchStrategy = searchStrategy;
    this.searchState = searchStrategy.createState();
  }

  flush(): string {
    return this.searchStrategy.flush(this.searchState);
  }
}
