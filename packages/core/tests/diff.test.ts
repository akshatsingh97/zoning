import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectScopeDiff, diffFiles, parseDiffLines } from '../src/diff';

const TWO_FILE_DIFF = [
  'diff --git a/pay/a.ts b/pay/a.ts',
  'index 111..222 100644',
  '--- a/pay/a.ts',
  '+++ b/pay/a.ts',
  '@@ -1,3 +1,4 @@',
  ' line1',
  '-old',
  '+new1',
  '+new2',
  ' line3',
  'diff --git a/old.txt b/old.txt',
  'deleted file mode 100644',
  '--- a/old.txt',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-gone1',
  '-gone2',
  '',
].join('\n');

const MULTI_HUNK_DIFF = [
  'diff --git a/multi.ts b/multi.ts',
  '--- a/multi.ts',
  '+++ b/multi.ts',
  '@@ -1,2 +1,2 @@',
  ' a',
  '-b',
  '+c',
  '@@ -10,3 +10,4 @@',
  ' x',
  ' y',
  ' z',
  '+w',
  '',
].join('\n');

describe('parseDiffLines', () => {
  it('collects new-file lines across context and additions only', () => {
    expect([...parseDiffLines(TWO_FILE_DIFF)].sort()).toEqual([
      'pay/a.ts:1',
      'pay/a.ts:2',
      'pay/a.ts:3',
      'pay/a.ts:4',
    ]);
  });

  it('tracks line numbers across hunks', () => {
    expect([...parseDiffLines(MULTI_HUNK_DIFF)].sort()).toEqual([
      'multi.ts:1',
      'multi.ts:10',
      'multi.ts:11',
      'multi.ts:12',
      'multi.ts:13',
      'multi.ts:2',
    ]);
  });

  it('returns an empty set for an empty diff', () => {
    expect(parseDiffLines('').size).toBe(0);
  });
});

describe('diffFiles', () => {
  it('lists changed files and skips deletions', () => {
    expect(diffFiles(TWO_FILE_DIFF)).toEqual(['pay/a.ts']);
  });
});

describe('collectScopeDiff', () => {
  function git(dir: string, args: string[]): string {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  }

  function setupRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-diff-'));
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    git(dir, ['config', 'user.name', 'test']);
    writeFileSync(join(dir, 'a.ts'), 'const a = 1;\n', 'utf8');
    writeFileSync(join(dir, 'b.ts'), 'const b = 1;\n', 'utf8');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-qm', 'init']);
    return dir;
  }

  it('combines staged, unstaged and new-file diffs for in-scope files', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, 'a.ts'), 'const a = 2;\n', 'utf8');
    writeFileSync(join(dir, 'b.ts'), 'const b = 2;\n', 'utf8');
    git(dir, ['add', 'b.ts']);
    writeFileSync(join(dir, 'c.ts'), 'const c = 1;\n', 'utf8');
    writeFileSync(join(dir, 'd.ts'), 'const d = 1;\n', 'utf8');

    const diff = collectScopeDiff(dir, ['a.ts', 'b.ts', 'c.ts']);
    expect(diff.empty).toBe(false);
    expect(diff.text).toContain('# staged changes');
    expect(diff.text).toContain('# unstaged changes');
    expect(diff.text).toContain('# new file: c.ts');
    expect(diff.text).toContain('const a = 2');
    expect(diff.text).toContain('const b = 2');
    expect(diff.text).toContain('const c = 1');
    expect(diff.text).not.toContain('const d = 1');
    expect(diff.files).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('reports an empty diff when nothing changed', () => {
    const dir = setupRepo();
    const diff = collectScopeDiff(dir, ['a.ts']);
    expect(diff.empty).toBe(true);
    expect(diff.files).toEqual([]);
  });

  it('relativizes git paths when the target is a subdir of the repo', () => {
    const root = mkdtempSync(join(tmpdir(), 'zoning-diff-'));
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'user.name', 'test']);
    mkdirSync(join(root, 'proj'), { recursive: true });
    writeFileSync(join(root, 'proj', 'a.ts'), 'const a = 1;\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'init']);
    writeFileSync(join(root, 'proj', 'a.ts'), 'const a = 2;\n', 'utf8');
    writeFileSync(join(root, 'proj', 'new.ts'), 'const n = 1;\n', 'utf8');

    const diff = collectScopeDiff(join(root, 'proj'), ['a.ts', 'new.ts']);
    expect(diff.empty).toBe(false);
    expect(diff.files).toEqual(['a.ts', 'new.ts']);
    expect(diff.text).toContain('+++ b/a.ts');
    expect(diff.text).toContain('# new file: new.ts');
    expect(diff.text).not.toContain('proj/a.ts');
  });
});
