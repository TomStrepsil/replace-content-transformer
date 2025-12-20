import StringBufferStrategyBase, {
  type StringBufferState
} from "../../string-buffer-strategy-base.ts";
import type { SyncProcessor } from "../../../replacement-processors/types.ts";

export class BufferedIndexOfCanonicalAsGeneratorSearchStrategy
  extends StringBufferStrategyBase
  implements SyncProcessor<string>
{
  private readonly replacement: (match: string, index: number) => string;
  private lastIndex: number | undefined;
  private readonly startToken: string;
  private readonly endToken: string;
  private matchIndex: number = 0;
  private state: StringBufferState;

  constructor(
    replacement: (match: string, index: number) => string,
    tokens: string[]
  ) {
    super();
    this.replacement = replacement;
    this.startToken = tokens[0];
    this.endToken = tokens[1];
    this.lastIndex = undefined;
    this.state = super.createState();
  }

  *processChunk(chunk: string): Generator<string, void, undefined> {
    chunk = this.state.buffer + chunk;
    this.state.buffer = "";
    this.lastIndex = 0;
    while (this.lastIndex < chunk.length) {
      let index = chunk.indexOf(this.startToken, this.lastIndex);
      if (index === -1) {
        const splitPoint = Math.max(
          this.lastIndex,
          chunk.length - this.startToken.length - 1
        );
        this.state.buffer = chunk.slice(splitPoint);
        const content = chunk.slice(this.lastIndex, splitPoint);
        if (content) {
          yield content;
        }
        return;
      }

      if (index > 0) {
        yield chunk.substring(this.lastIndex, index);
      }

      const endIndex = chunk.indexOf(
        this.endToken,
        index + this.startToken.length
      );
      if (endIndex !== -1) {
        this.lastIndex = endIndex + this.endToken.length;
        let replacement = this.replacement(
          chunk.substring(index, this.lastIndex),
          this.matchIndex++
        );
        yield replacement;
      } else {
        this.state.buffer = chunk.substring(index);
        return;
      }
    }
  }

  flush(): string {
    return super.flush(this.state);
  }
}
