import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOOK_MARKER, hookScript, installHook } from '../src/hook';

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
}

describe('hookScript', () => {
  it('runs guard in the repo top level with a marked header', () => {
    const script = hookScript('/opt/zoning/dist/index.js');
    expect(script).toContain(HOOK_MARKER);
    expect(script).toContain('git rev-parse --show-toplevel');
    expect(script).toContain('exec node "/opt/zoning/dist/index.js" guard "$REPO"');
  });

  it('escapes shell metacharacters in the CLI path', () => {
    const script = hookScript('/we$"ird`/cli.js');
    expect(script).toContain('exec node "/we\\$\\"ird\\`/cli.js" guard "$REPO"');
  });
});

describe('installHook', () => {
  function setupRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-hook-'));
    git(dir, ['init', '-q']);
    return dir;
  }

  it('writes an executable pre-commit hook', () => {
    const dir = setupRepo();
    const { path, created } = installHook(dir, '/cli/index.js');
    expect(path).toBe(join(dir, '.git', 'hooks', 'pre-commit'));
    expect(created).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain(HOOK_MARKER);
    expect(statSync(path).mode & 0o111).toBeTruthy();
  });

  it('reinstalls idempotently over its own hook', () => {
    const dir = setupRepo();
    installHook(dir, '/cli-a/index.js');
    const second = installHook(dir, '/cli-b/index.js');
    expect(second.created).toBe(false);
    expect(readFileSync(second.path, 'utf8')).toContain('/cli-b/index.js');
  });

  it('refuses to clobber a foreign hook', () => {
    const dir = setupRepo();
    git(dir, ['config', 'user.email', 'test@example.com']);
    const hookPath = join(dir, '.git', 'hooks', 'pre-commit');
    writeFileSync(hookPath, '#!/bin/sh\necho mine\n', 'utf8');
    expect(() => installHook(dir, '/cli/index.js')).toThrow('already exists');
    expect(readFileSync(hookPath, 'utf8')).toBe('#!/bin/sh\necho mine\n');
  });

  it('throws outside a git repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-hook-'));
    expect(() => installHook(dir, '/cli/index.js')).toThrow('is it a git repo?');
  });
});
