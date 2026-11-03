import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { toPosix } from './importGraph.js';

export interface ScopeDiff {
  text: string;
  files: string[];
  empty: boolean;
}

function git(repoRoot: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(
      `cannot run git diff in ${repoRoot} (is it a git repo?): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function gitTopLevel(repoRoot: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error(`cannot use git in ${repoRoot} (is it a git repo?)`);
  }
}

function stripDiffPrefix(diffText: string, prefix: string): string {
  if (prefix === '') return diffText;
  return diffText
    .split(`a/${prefix}/`)
    .join('a/')
    .split(`b/${prefix}/`)
    .join('b/');
}

function untrackedInScope(repoRoot: string, scope: string[]): string[] {
  const status = git(repoRoot, ['status', '--porcelain=v1', '--', ...scope]);
  // Status paths are relative to the git top level; relativize to the target.
  const topLevel = gitTopLevel(repoRoot);
  const out: string[] = [];
  for (const line of status.split('\n')) {
    if (!line.startsWith('?? ')) continue;
    let file = line.slice('?? '.length).trim();
    if (file.startsWith('"') && file.endsWith('"')) file = file.slice(1, -1);
    if (file === '') continue;
    const rel = toPosix(relative(realpathSync(resolve(repoRoot)), resolve(topLevel, file)));
    if (rel !== '' && !rel.startsWith('..')) out.push(rel);
  }
  return out;
}

function diffNewFile(repoRoot: string, file: string): string {
  try {
    return execFileSync('git', ['diff', '--no-index', '--', '/dev/null', file], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    // --no-index exits 1 when the files differ; the diff is on stdout.
    const stdout = (err as { stdout?: unknown }).stdout;
    if (typeof stdout === 'string' && stdout !== '') return stdout;
    throw new Error(
      `cannot diff new file ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function collectScopeDiff(repoRoot: string, scope: string[]): ScopeDiff {
  // Diff output paths are relative to the git top level; strip the
  // top-level-to-target prefix so names match zones and contract scope.
  const prefix = toPosix(relative(gitTopLevel(repoRoot), realpathSync(resolve(repoRoot))));
  const parts: string[] = [];
  const staged = git(repoRoot, ['diff', '--cached', '--', ...scope]);
  if (staged.trim() !== '') parts.push('# staged changes\n' + stripDiffPrefix(staged, prefix));
  const unstaged = git(repoRoot, ['diff', '--', ...scope]);
  if (unstaged.trim() !== '') parts.push('# unstaged changes\n' + stripDiffPrefix(unstaged, prefix));
  for (const file of untrackedInScope(repoRoot, scope)) {
    const text = diffNewFile(repoRoot, file);
    if (text.trim() !== '') parts.push(`# new file: ${file}\n` + stripDiffPrefix(text, prefix));
  }
  const text = parts.join('\n');
  return { text, files: diffFiles(text), empty: text.trim() === '' };
}

export function diffFiles(diffText: string): string[] {
  const files = new Set<string>();
  for (const line of diffText.split('\n')) {
    if (!line.startsWith('+++ ')) continue;
    const path = line.slice('+++ '.length).trim().split('\t')[0] as string;
    if (path === '/dev/null') continue;
    files.add(path.startsWith('b/') ? path.slice('b/'.length) : path);
  }
  return [...files].sort();
}

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseDiffLines(diffText: string): Set<string> {
  const lines = new Set<string>();
  let file: string | undefined;
  let newLine = 0;
  let inHunk = false;
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const path = raw.slice('+++ '.length).trim().split('\t')[0] as string;
      file = path === '/dev/null' ? undefined : path.startsWith('b/') ? path.slice(2) : path;
      inHunk = false;
      continue;
    }
    const hunk = HUNK_RE.exec(raw);
    if (hunk !== null) {
      newLine = Number.parseInt(hunk[1] as string, 10);
      inHunk = true;
      continue;
    }
    if (!inHunk || file === undefined) continue;
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      lines.add(`${file}:${newLine}`);
      newLine += 1;
    } else if (raw.startsWith(' ') || raw === '') {
      if (raw !== '') lines.add(`${file}:${newLine}`);
      newLine += 1;
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      // deleted line: no new-file line number
    } else if (raw.startsWith('\\')) {
      // "\ No newline at end of file": no line
    } else {
      inHunk = false;
    }
  }
  return lines;
}
