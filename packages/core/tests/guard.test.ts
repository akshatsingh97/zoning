import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkKeyFor, writeStoredCheck } from '../src/check';
import { collectScopeDiff } from '../src/diff';
import {
  formatGuardResult,
  guardModel,
  runGuard,
  stagedFiles,
} from '../src/guard';
import { setActiveContract, writeContract } from '../src/contracts';
import { DEFAULT_MODEL } from '../src/llm';

const MODEL = 'test-model';

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
}

function setupShop(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zoning-guard-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'test']);
  mkdirSync(join(dir, 'payment'), { recursive: true });
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(
    join(dir, 'zones.yml'),
    [
      'version: 1',
      'critical:',
      '  - path: payment/**',
      '    reason: handles money',
      'shared:',
      '  - path: lib/util.ts',
      '    reason: imported by many modules',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(join(dir, 'payment', 'capture.ts'), 'export const a = 1;\n', 'utf8');
  writeFileSync(join(dir, 'lib', 'util.ts'), 'export const u = 1;\n', 'utf8');
  writeFileSync(join(dir, 'app.ts'), "import './lib/util.js';\n", 'utf8');
  writeFileSync(join(dir, 'notes.txt'), 'hello\n', 'utf8');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-qm', 'init']);
  return dir;
}

function coverCapture(dir: string): { slug: string } {
  const { slug } = writeContract(dir, {
    task: 'change capture',
    in_scope: ['payment/capture.ts'],
    must_change: [],
    must_not_change: [],
  });
  setActiveContract(dir, slug);
  return { slug };
}

function storePass(dir: string, slug: string): void {
  const contract = {
    task: 'change capture',
    in_scope: ['payment/capture.ts'],
    must_change: [] as string[],
    must_not_change: [] as string[],
  };
  const diff = collectScopeDiff(dir, contract.in_scope);
  const key = checkKeyFor(MODEL, slug, contract, diff.text);
  writeStoredCheck(join(dir, '.zoning', 'checks'), key, slug, {
    verdict: 'pass',
    violations: [],
    out_of_scope: [],
  });
}

describe('stagedFiles', () => {
  it('lists staged files', () => {
    const dir = setupShop();
    expect(stagedFiles(dir)).toEqual([]);
    writeFileSync(join(dir, 'notes.txt'), 'hello\nmore\n', 'utf8');
    git(dir, ['add', 'notes.txt']);
    expect(stagedFiles(dir)).toEqual(['notes.txt']);
  });

  it('relativizes to a subdir target and drops outside files', () => {
    const root = mkdtempSync(join(tmpdir(), 'zoning-guard-'));
    git(root, ['init', '-q']);
    mkdirSync(join(root, 'proj'), { recursive: true });
    writeFileSync(join(root, 'proj', 'a.ts'), 'x\n', 'utf8');
    writeFileSync(join(root, 'top.ts'), 'x\n', 'utf8');
    git(root, ['add', '.']);
    expect(stagedFiles(join(root, 'proj'))).toEqual(['a.ts']);
  });
});

describe('guardModel', () => {
  it('prefers the override, then env, then the default', () => {
    expect(guardModel({}, 'm')).toBe('m');
    expect(guardModel({ MODEL_API_KEY: 'k', ZONING_MODEL: 'env-model' })).toBe('env-model');
    expect(guardModel({ MODEL_API_KEY: 'k' })).toBe(DEFAULT_MODEL);
    expect(guardModel({})).toBe(DEFAULT_MODEL);
  });
});

describe('runGuard', () => {
  it('fails a drive-by with no active contract', () => {
    const dir = setupShop();
    writeFileSync(join(dir, 'payment', 'capture.ts'), 'export const a = 2;\n', 'utf8');
    git(dir, ['add', 'payment/capture.ts']);
    const result = runGuard(dir, { model: MODEL });
    expect(result.ok).toBe(false);
    expect(result.driveBy).toEqual([{ file: 'payment/capture.ts', reason: 'handles money' }]);
    const text = formatGuardResult(result);
    expect(text).toContain('blocked: payment/capture.ts');
    expect(text).toContain('handles money');
    expect(text).toContain('no active contract');
  });

  it('fails a drive-by outside the contract scope', () => {
    const dir = setupShop();
    const { slug } = writeContract(dir, {
      task: 'other work',
      in_scope: ['notes.txt'],
      must_change: [],
      must_not_change: [],
    });
    setActiveContract(dir, slug);
    writeFileSync(join(dir, 'payment', 'capture.ts'), 'export const a = 2;\n', 'utf8');
    git(dir, ['add', 'payment/capture.ts']);
    const result = runGuard(dir, { model: MODEL });
    expect(result.ok).toBe(false);
    expect(formatGuardResult(result)).toContain(slug);
  });

  it('fails a covered change with no passing check', () => {
    const dir = setupShop();
    const { slug } = coverCapture(dir);
    writeFileSync(join(dir, 'payment', 'capture.ts'), 'export const a = 2;\n', 'utf8');
    git(dir, ['add', 'payment/capture.ts']);
    const result = runGuard(dir, { model: MODEL });
    expect(result.ok).toBe(false);
    expect(result.driveBy).toEqual([]);
    expect(result.checkNeeded).toBe(true);
    expect(result.checkPassed).toBe(false);
    expect(formatGuardResult(result)).toContain('no passing check');
    expect(formatGuardResult(result)).toContain(slug);
  });

  it('passes a covered change with a stored pass', () => {
    const dir = setupShop();
    const { slug } = coverCapture(dir);
    writeFileSync(join(dir, 'payment', 'capture.ts'), 'export const a = 2;\n', 'utf8');
    git(dir, ['add', 'payment/capture.ts']);
    storePass(dir, slug);
    const result = runGuard(dir, { model: MODEL });
    expect(result.ok).toBe(true);
    expect(result.checkPassed).toBe(true);
    expect(formatGuardResult(result)).toContain('passing check');
  });

  it('fails when the stored check failed', () => {
    const dir = setupShop();
    const { slug } = coverCapture(dir);
    writeFileSync(join(dir, 'payment', 'capture.ts'), 'export const a = 2;\n', 'utf8');
    git(dir, ['add', 'payment/capture.ts']);
    const contract = {
      task: 'change capture',
      in_scope: ['payment/capture.ts'],
      must_change: [] as string[],
      must_not_change: [] as string[],
    };
    const diff = collectScopeDiff(dir, contract.in_scope);
    writeStoredCheck(join(dir, '.zoning', 'checks'), checkKeyFor(MODEL, slug, contract, diff.text), slug, {
      verdict: 'fail',
      violations: [],
      out_of_scope: [],
    });
    expect(runGuard(dir, { model: MODEL }).ok).toBe(false);
  });

  it('passes shared files with a blast-radius warning', () => {
    const dir = setupShop();
    coverCapture(dir);
    writeFileSync(join(dir, 'lib', 'util.ts'), 'export const u = 2;\n', 'utf8');
    git(dir, ['add', 'lib/util.ts']);
    const result = runGuard(dir, { model: MODEL });
    expect(result.ok).toBe(true);
    expect(result.shared).toEqual([{ file: 'lib/util.ts', importers: ['app.ts'] }]);
    expect(formatGuardResult(result)).toContain('warning: lib/util.ts is Shared');
    expect(formatGuardResult(result)).toContain('app.ts');
  });

  it('passes open files silently', () => {
    const dir = setupShop();
    coverCapture(dir);
    writeFileSync(join(dir, 'notes.txt'), 'hello\nmore\n', 'utf8');
    git(dir, ['add', 'notes.txt']);
    const result = runGuard(dir, { model: MODEL });
    expect(result.ok).toBe(true);
    expect(formatGuardResult(result)).toBe('');
  });

  it('throws without a zones.yml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-guard-'));
    git(dir, ['init', '-q']);
    expect(() => runGuard(dir, { model: MODEL })).toThrow('no zones.yml');
  });
});
