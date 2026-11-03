import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export const HOOK_MARKER = 'zoning pre-commit hook';

export function hookScript(cliEntryAbs: string): string {
  const escaped = cliEntryAbs.replace(/(["\\$`])/g, '\\$1');
  return [
    '#!/bin/sh',
    `# ${HOOK_MARKER} (written by zoning install-hook; safe to re-run install-hook)`,
    'REPO="$(git rev-parse --show-toplevel)"',
    `exec node "${escaped}" guard "$REPO"`,
    '',
  ].join('\n');
}

export function gitHooksDir(repoRoot: string): string {
  let gitDir: string;
  try {
    gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error(`cannot install hook in ${repoRoot} (is it a git repo?)`);
  }
  const abs = isAbsolute(gitDir) ? gitDir : join(resolve(repoRoot), gitDir);
  return join(abs, 'hooks');
}

export interface InstalledHook {
  path: string;
  created: boolean;
}

export function installHook(repoRoot: string, cliEntryAbs: string): InstalledHook {
  const hooksDir = gitHooksDir(repoRoot);
  mkdirSync(hooksDir, { recursive: true });
  const path = join(hooksDir, 'pre-commit');
  const existed = existsSync(path);
  if (existed && !readFileSync(path, 'utf8').includes(HOOK_MARKER)) {
    throw new Error(
      `a pre-commit hook already exists at ${path} (not written by zoning) — move it aside or add the zoning guard call to it`,
    );
  }
  writeFileSync(path, hookScript(cliEntryAbs), 'utf8');
  chmodSync(path, 0o755);
  return { path, created: !existed };
}
