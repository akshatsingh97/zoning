import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  contractSlug,
  dedupeSlug,
  normalizeScopePath,
  readActiveContract,
  readGapQuestions,
  resolveScopeFile,
  setActiveContract,
  writeContract,
  writeGapQuestions,
} from '../src/contracts';

const CONTRACT = {
  task: 'Add a retry to payment capture',
  in_scope: ['packages/payment/capture.ts'],
  must_change: ['Retry capture on a network error'],
  must_not_change: ['Never charge a customer twice'],
};

describe('contractSlug', () => {
  it.each([
    ['Add a retry to payment capture', 'add-a-retry-to-payment-capture'],
    ['  Fix AUTH_login!! ', 'fix-auth-login'],
    ['relay_2 fast', 'relay-2-fast'],
    ['!!!', 'contract'],
    ['', 'contract'],
  ])('slugifies %j to %j', (task, expected) => {
    expect(contractSlug(task)).toBe(expected);
  });

  it('truncates long tasks', () => {
    expect(contractSlug('a'.repeat(100))).toHaveLength(60);
  });
});

describe('dedupeSlug', () => {
  it('keeps unused slugs and numbers clashes', () => {
    expect(dedupeSlug([], 'retry')).toBe('retry');
    expect(dedupeSlug(['retry'], 'retry')).toBe('retry-2');
    expect(dedupeSlug(['retry', 'retry-2'], 'retry')).toBe('retry-3');
  });
});

describe('normalizeScopePath', () => {
  it.each([
    ['packages/a.ts', 'packages/a.ts'],
    ['./packages/a.ts', 'packages/a.ts'],
    ['  packages/a.ts  ', 'packages/a.ts'],
    ['packages\\a.ts', 'packages/a.ts'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeScopePath(input)).toBe(expected);
  });
});

describe('resolveScopeFile', () => {
  it('resolves a file inside the repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-scope-'));
    writeFileSync(join(dir, 'a.ts'), 'x', 'utf8');
    expect(resolveScopeFile(dir, 'a.ts')).toBe(join(dir, 'a.ts'));
    expect(resolveScopeFile(dir, './a.ts')).toBe(join(dir, 'a.ts'));
  });

  it('rejects absolute paths, escapes, missing files and directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-scope-'));
    writeFileSync(join(dir, 'a.ts'), 'x', 'utf8');
    mkdirSync(join(dir, 'sub'));
    expect(() => resolveScopeFile(dir, '/abs/a.ts')).toThrow('must be relative');
    expect(() => resolveScopeFile(dir, '../escape.ts')).toThrow('outside the repo');
    expect(() => resolveScopeFile(dir, 'missing.ts')).toThrow('not found');
    expect(() => resolveScopeFile(dir, 'sub')).toThrow('not found');
  });
});

describe('writeContract', () => {
  it('writes a valid contract yml with a slug from the task', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-contract-'));
    const { slug, path } = writeContract(dir, CONTRACT);
    expect(slug).toBe('add-a-retry-to-payment-capture');
    expect(path).toBe(join(dir, '.zoning', 'contracts', `${slug}.yml`));
    expect(readFileSync(path, 'utf8')).toContain('Never charge a customer twice');
  });

  it('dedupes the slug when the task repeats', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-contract-'));
    const first = writeContract(dir, CONTRACT);
    const second = writeContract(dir, CONTRACT);
    expect(first.slug).toBe('add-a-retry-to-payment-capture');
    expect(second.slug).toBe('add-a-retry-to-payment-capture-2');
  });

  it('rejects an invalid contract', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-contract-'));
    expect(() => writeContract(dir, { task: 'x', in_scope: [] })).toThrow();
  });
});

describe('writeGapQuestions and readGapQuestions', () => {
  it('round-trips questions beside the contract', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-contract-'));
    const { slug } = writeContract(dir, CONTRACT);
    const path = writeGapQuestions(dir, slug, ['Why?', 'When?']);
    expect(path).toBe(join(dir, '.zoning', 'contracts', `${slug}.gaps.json`));
    expect(readGapQuestions(dir, slug)).toEqual(['Why?', 'When?']);
  });

  it('returns undefined when missing or corrupt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-contract-'));
    expect(readGapQuestions(dir, 'nope')).toBeUndefined();
    const { slug } = writeContract(dir, CONTRACT);
    writeFileSync(join(dir, '.zoning', 'contracts', `${slug}.gaps.json`), 'bad', 'utf8');
    expect(readGapQuestions(dir, slug)).toBeUndefined();
  });
});

describe('setActiveContract and readActiveContract', () => {
  it('round-trips the active contract', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-contract-'));
    const { slug } = writeContract(dir, CONTRACT);
    setActiveContract(dir, slug);
    expect(readActiveContract(dir)).toEqual({
      slug,
      contract: CONTRACT,
      path: join(dir, '.zoning', 'contracts', `${slug}.yml`),
    });
  });

  it('returns undefined when nothing is active', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-contract-'));
    expect(readActiveContract(dir)).toBeUndefined();
  });

  it('returns undefined when the active file points nowhere', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-contract-'));
    setActiveContract(dir, 'missing');
    expect(readActiveContract(dir)).toBeUndefined();
  });

  it('returns undefined when the contract yml is corrupt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-contract-'));
    const { slug } = writeContract(dir, CONTRACT);
    setActiveContract(dir, slug);
    writeFileSync(join(dir, '.zoning', 'contracts', `${slug}.yml`), '{{{bad', 'utf8');
    expect(readActiveContract(dir)).toBeUndefined();
  });
});
