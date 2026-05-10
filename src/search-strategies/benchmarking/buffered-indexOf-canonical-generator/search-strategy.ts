import StringBufferStrategyBase, {
  type StringBufferState
} from "../../string-buffer-strategy-base.ts";
import type { ReplacementContext } from "../../../engines/types.ts";

export class BufferedIndexOfCanonicalAsGeneratorSearchStrategy
  extends StringBufferStrategyBase
{
  private readonly replacement: (match: string, context: ReplacementContext) => string;
  private lastIndex: number | undefined;
  private readonly startToken: string;
  private readonly endToken: string;
  private matchIndex: number = 0;
  private state: StringBufferState;

  constructor(
    replacement: (match: string, context: ReplacementContext) => string,
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
    const bufferLength = this.state.buffer.length;
    const baseOffset = this.state.streamOffset - bufferLength;
    chunk = this.state.buffer + chunk;
    this.state.buffer = "";
    const chunkLength = chunk.length;
    this.lastIndex = 0;
    try {
      while (this.lastIndex < chunkLength) {
        let index = chunk.indexOf(this.startToken, this.lastIndex);
        if (index === -1) {
          const splitPoint = Math.max(
            this.lastIndex,
            chunkLength - this.startToken.length - 1
          );
          this.state.buffer = chunk.slice(splitPoint);
          const content = chunk.slice(this.lastIndex, splitPoint);
          if (content) {
            yield content;
          }
          this.lastIndex = chunkLength;
          return;
        }

        if (index > this.lastIndex) {
          yield chunk.substring(this.lastIndex, index);
        }

        const endIndex = chunk.indexOf(
          this.endToken,
          index + this.startToken.length
        );
        if (endIndex !== -1) {
          this.lastIndex = endIndex + this.endToken.length;
          const match = chunk.substring(index, this.lastIndex);
          const replacement = this.replacement(match, {
            matchIndex: this.matchIndex++,
            streamIndices: [baseOffset + index, baseOffset + this.lastIndex]
          });
          yield replacement;
        } else {
          this.state.buffer = chunk.substring(index);
          this.lastIndex = chunkLength;
          return;
        }
      }
    } finally {
      if (this.lastIndex < chunkLength && !this.state.buffer) {
        this.state.buffer += chunk.slice(this.lastIndex);
      }
      this.state.streamOffset += chunkLength - bufferLength;
    }
  }

  flush(): string {
    return super.flush(this.state);
  }
}
