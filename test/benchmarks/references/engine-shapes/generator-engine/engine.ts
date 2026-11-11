import type {
  EngineSink,
  ReplacementContext,
  SyncTransformEngine
} from "../../../../../src/engines/types.ts";
import type { GeneratorSearchStrategy } from "./types.ts";

export class GeneratorSyncTransformEngine<TState, TMatch = string>
  implements SyncTransformEngine
{
  readonly #searchStrategy: GeneratorSearchStrategy<TState, TMatch>;
  readonly #replacement: (match: TMatch, context: ReplacementContext) => string;
  readonly #state: TState;
  #sink!: EngineSink;
  #matchIndex = 0;

  constructor(
    searchStrategy: GeneratorSearchStrategy<TState, TMatch>,
    replacement: (match: TMatch, context: ReplacementContext) => string
  ) {
    this.#searchStrategy = searchStrategy;
    this.#replacement = replacement;
    this.#state = searchStrategy.createState();
  }

  start(sink: EngineSink): void {
    this.#sink = sink;
  }

  write(chunk: string): void {
    const sink = this.#sink;
    for (const result of this.#searchStrategy.processChunk(chunk, this.#state)) {
      if (!result.isMatch) {
        sink.enqueue(result.content);
        continue;
      }
      sink.enqueue(
        this.#replacement(result.content, {
          matchIndex: this.#matchIndex++,
          streamIndices: result.streamIndices
        })
      );
    }
  }

  end(): void {
    const held = this.#searchStrategy.flush(this.#state);
    if (held) this.#sink.enqueue(held);
  }
}
