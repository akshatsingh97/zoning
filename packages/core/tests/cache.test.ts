import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findCacheKey } from '../src/cache';

describe('findCacheKey', () => {
  it('finds an entry by prompt prefix and content hash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-find-'));
    writeFileSync(join(dir, 'tag-v1-model-a-hash1.json'), '{}', 'utf8');
    writeFileSync(join(dir, 'gaps-v1-model-a-hash1.json'), '{}', 'utf8');
    expect(findCacheKey(dir, 'tag-v1', 'hash1')).toBe('tag-v1-model-a-hash1');
    expect(findCacheKey(dir, 'gaps-v1', 'hash1')).toBe('gaps-v1-model-a-hash1');
  });

  it('returns undefined on misses and missing dirs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-find-'));
    writeFileSync(join(dir, 'tag-v1-model-a-hash1.json'), '{}', 'utf8');
    expect(findCacheKey(dir, 'tag-v1', 'other')).toBeUndefined();
    expect(findCacheKey(dir, 'check-v1', 'hash1')).toBeUndefined();
    expect(findCacheKey(join(dir, 'nope'), 'tag-v1', 'hash1')).toBeUndefined();
  });
});
