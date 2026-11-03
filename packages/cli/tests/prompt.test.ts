import { describe, expect, it } from 'vitest';
import { flattenLists, splitList } from '../src/prompt';

describe('splitList', () => {
  it('splits on commas and drops empties', () => {
    expect(splitList('a.ts, b.ts ,, c.ts')).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(splitList('')).toEqual([]);
    expect(splitList('  ')).toEqual([]);
  });
});

describe('flattenLists', () => {
  it('merges repeatable flags', () => {
    expect(flattenLists(['a.ts,b.ts', 'c.ts', ''])).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});
