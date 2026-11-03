import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { contentHash } from '../src/cache';
import {
  cacheKeyFor,
  fileSnippet,
  fileTagCache,
  selectTagCandidates,
  tagFile,
  tagUpgradesToCritical,
  type TagCandidate,
} from '../src/tag';

const TAG_JSON = JSON.stringify({ handles: ['money'], confidence: 'high', reason: 'charges cards' });

function candidate(overrides: Partial<TagCandidate> & { file: string }): TagCandidate {
  return { tier: 'open', fanIn: 0, hotfixes: 0, ...overrides };
}

describe('selectTagCandidates', () => {
  const files = [
    candidate({ file: 'open.ts', tier: 'open', fanIn: 9 }),
    candidate({ file: 'shared-low.ts', tier: 'shared', fanIn: 3 }),
    candidate({ file: 'crit.ts', tier: 'critical', fanIn: 0 }),
    candidate({ file: 'shared-high.ts', tier: 'shared', fanIn: 8 }),
  ];

  it('sends only critical and shared files, critical first, then by fan-in', () => {
    expect(selectTagCandidates(files, 10).map((f) => f.file)).toEqual([
      'crit.ts',
      'shared-high.ts',
      'shared-low.ts',
    ]);
  });

  it('never sends open files, however high their fan-in', () => {
    const onlyOpen = [candidate({ file: 'open.ts', tier: 'open', fanIn: 99 })];
    expect(selectTagCandidates(onlyOpen, 10)).toEqual([]);
  });

  it('respects the per-run cap', () => {
    expect(selectTagCandidates(files, 2)).toHaveLength(2);
    expect(selectTagCandidates(files, 0)).toEqual([]);
  });
});

describe('tagUpgradesToCritical', () => {
  it.each([
    [['money'], 'high', true],
    [['permissions'], 'high', true],
    [['money', 'infra'], 'high', true],
    [['money'], 'medium', false],
    [['permissions'], 'low', false],
    [['infra'], 'high', false],
    [['personal_data'], 'high', false],
    [['none'], 'high', false],
  ])('handles=%j confidence=%s -> %s', (handles, confidence, expected) => {
    expect(
      tagUpgradesToCritical({ handles: handles as ['money'], confidence: confidence as 'high', reason: 'r' }),
    ).toBe(expected);
  });
});

describe('contentHash and cacheKeyFor', () => {
  it('is stable for the same content and distinct otherwise', () => {
    expect(contentHash('a')).toBe(contentHash('a'));
    expect(contentHash('a')).not.toBe(contentHash('b'));
    expect(cacheKeyFor('m', 'a')).not.toBe(cacheKeyFor('other', 'a'));
  });
});

describe('fileSnippet', () => {
  it('keeps short files whole and truncates long ones', () => {
    expect(fileSnippet('short')).toBe('short');
    expect(fileSnippet('x'.repeat(5000))).toHaveLength(4000);
  });
});

describe('tagFile with cache', () => {
  it('calls the model once, then serves the same content from cache', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-cache-'));
    const chat = vi.fn(async () => TAG_JSON);
    const deps = { chat, model: 'test-model', cache: fileTagCache(dir) };

    const first = await tagFile('a.ts', 'content', deps);
    expect(first).toEqual({
      tag: { handles: ['money'], confidence: 'high', reason: 'charges cards' },
      cached: false,
    });
    const second = await tagFile('a.ts', 'content', deps);
    expect(second.cached).toBe(true);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('treats changed content as a miss', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-cache-'));
    const chat = vi.fn(async () => TAG_JSON);
    const deps = { chat, model: 'test-model', cache: fileTagCache(dir) };
    await tagFile('a.ts', 'v1', deps);
    await tagFile('a.ts', 'v2', deps);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('treats a corrupt cache entry as a miss', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-cache-'));
    const chat = vi.fn(async () => TAG_JSON);
    const deps = { chat, model: 'test-model', cache: fileTagCache(dir) };
    const key = cacheKeyFor('test-model', 'content');
    writeFileSync(join(dir, `${key}.json`), 'not json', 'utf8');
    const result = await tagFile('a.ts', 'content', deps);
    expect(result.cached).toBe(false);
    expect(chat).toHaveBeenCalledTimes(1);
  });
});
