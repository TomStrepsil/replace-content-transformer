/**
 * A simple replace content transformer
 */
export class ReplaceContentTransformer {
  private searchValue: string | RegExp;
  private replaceValue: string;

  constructor(searchValue: string | RegExp, replaceValue: string) {
    this.searchValue = searchValue;
    this.replaceValue = replaceValue;
  }

  transform(content: string): string {
    return content.replace(this.searchValue, this.replaceValue);
  }
}

export default ReplaceContentTransformer;
