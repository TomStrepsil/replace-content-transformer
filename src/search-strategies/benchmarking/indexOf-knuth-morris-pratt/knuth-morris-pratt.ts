class KMP {
  private readonly needle: string;
  private readonly searchWindowLength: number;
  private readonly LPS: number[];

  constructor(needle: string) {
    this.needle = needle;
    this.searchWindowLength = needle.length - 1;
    this.LPS = this.buildLongestPrefixSuffixArray(needle);
  }

  private buildLongestPrefixSuffixArray(pattern: string): number[] {
    const patternLength = pattern.length;
    const LPS: number[] = Array(patternLength + 1);
    let currentPosition = 1;
    let candidatePosition = 0;

    LPS[0] = -1;
    while (currentPosition < patternLength) {
      if (pattern[currentPosition] === pattern[candidatePosition]) {
        LPS[currentPosition] = LPS[candidatePosition];
      } else {
        LPS[currentPosition] = candidatePosition;
        while (
          candidatePosition >= 0 &&
          pattern[currentPosition] !== pattern[candidatePosition]
        ) {
          candidatePosition = LPS[candidatePosition];
        }
      }
      currentPosition++;
      candidatePosition++;
    }
    LPS[currentPosition] = candidatePosition;
    return LPS;
  }

  getLengthOfSuffixMatch(haystack: string): number {
    let haystackIndex = haystack.length - this.searchWindowLength;
    let needleIndex = 0;

    while (
      haystackIndex < haystack.length &&
      needleIndex < this.needle.length
    ) {
      if (this.needle[needleIndex] === haystack[haystackIndex]) {
        haystackIndex++;
        needleIndex++;
        continue;
      }
      needleIndex = this.LPS[needleIndex];
      if (needleIndex < 0) {
        haystackIndex++;
        needleIndex++;
      }
    }
    return needleIndex;
  }
}

export default KMP;
