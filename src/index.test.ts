import { describe, it, expect } from 'vitest';
import { ReplaceContentTransformer } from './index';

describe('ReplaceContentTransformer', () => {
  it('should replace string content', () => {
    const transformer = new ReplaceContentTransformer('hello', 'goodbye');
    const result = transformer.transform('hello world');
    expect(result).toBe('goodbye world');
  });

  it('should replace content using regex', () => {
    const transformer = new ReplaceContentTransformer(/\d+/g, 'X');
    const result = transformer.transform('test 123 and 456');
    expect(result).toBe('test X and X');
  });

  it('should handle no matches', () => {
    const transformer = new ReplaceContentTransformer('foo', 'bar');
    const result = transformer.transform('hello world');
    expect(result).toBe('hello world');
  });
});
