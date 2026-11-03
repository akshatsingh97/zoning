import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  cleanQuestions,
  fileGapsCache,
  gapsCacheKeyFor,
  gapsInputHash,
  gapsPromptFor,
  requestGapQuestions,
} from '../src/gaps';

const CONTRACT = {
  task: 'Add a retry to payment capture',
  in_scope: ['packages/payment/capture.ts'],
  must_change: ['Retry capture on a network error'],
  must_not_change: ['Never charge a customer twice'],
};

describe('gapsPromptFor', () => {
  it('includes the contract and every in-scope file', () => {
    const prompt = gapsPromptFor(CONTRACT, [
      { file: 'a.ts', content: 'content-a' },
      { file: 'b.ts', content: 'content-b' },
    ]);
    expect(prompt).toContain('Add a retry to payment capture');
    expect(prompt).toContain('Never charge a customer twice');
    expect(prompt).toContain('File: a.ts');
    expect(prompt).toContain('content-a');
    expect(prompt).toContain('File: b.ts');
  });

  it('truncates very long files with a marker', () => {
    const prompt = gapsPromptFor(CONTRACT, [{ file: 'big.ts', content: 'x'.repeat(20000) }]);
    expect(prompt).toContain('[... truncated ...]');
    expect(prompt.length).toBeLessThan(20000);
  });
});

describe('gapsInputHash', () => {
  it('is the stable suffix of the cache key across models', () => {
    const files = [{ file: 'a.ts', content: 'content' }];
    const hash = gapsInputHash(CONTRACT, files);
    expect(gapsCacheKeyFor('model-a', CONTRACT, files).endsWith(`-${hash}`)).toBe(true);
    expect(gapsCacheKeyFor('model-b', CONTRACT, files).endsWith(`-${hash}`)).toBe(true);
    expect(gapsInputHash({ ...CONTRACT, task: 'x' }, files)).not.toBe(hash);
  });
});

describe('cleanQuestions', () => {
  it('trims, drops empties, and keeps at most 3', () => {
    expect(cleanQuestions(['  one? ', '', 'two?', 'three?', 'four?'])).toEqual([
      'one?',
      'two?',
      'three?',
    ]);
  });

  it('allows an empty list', () => {
    expect(cleanQuestions([])).toEqual([]);
  });
});

describe('requestGapQuestions', () => {
  function stubChat(response: string) {
    return vi.fn(async () => response);
  }

  it('returns questions and caches them for identical inputs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-gaps-'));
    const chat = stubChat(JSON.stringify({ questions: ['What if it times out?'] }));
    const cache = fileGapsCache(dir);
    const files = [{ file: 'a.ts', content: 'content' }];
    const first = await requestGapQuestions(chat, 'test-model', cache, CONTRACT, files);
    expect(first).toEqual({ questions: ['What if it times out?'], cached: false });
    const second = await requestGapQuestions(chat, 'test-model', cache, CONTRACT, files);
    expect(second).toEqual({ questions: ['What if it times out?'], cached: true });
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('caps the model output at 3 questions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-gaps-'));
    const chat = stubChat(JSON.stringify({ questions: ['1?', '2?', '3?', '4?', '5?'] }));
    const result = await requestGapQuestions(chat, 'test-model', fileGapsCache(dir), CONTRACT, [
      { file: 'a.ts', content: 'content' },
    ]);
    expect(result.questions).toEqual(['1?', '2?', '3?']);
  });

  it('treats a changed contract as a cache miss', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-gaps-'));
    const chat = stubChat(JSON.stringify({ questions: [] }));
    const cache = fileGapsCache(dir);
    const files = [{ file: 'a.ts', content: 'content' }];
    await requestGapQuestions(chat, 'test-model', cache, CONTRACT, files);
    await requestGapQuestions(
      chat,
      'test-model',
      cache,
      { ...CONTRACT, task: 'Something else' },
      files,
    );
    expect(chat).toHaveBeenCalledTimes(2);
  });
});
