import { execFileSync } from 'node:child_process';

const HOTFIX_RE = /fix|hotfix|revert/i;

export function hotfixCount(repoRoot: string, posixPath: string): number {
  try {
    const out = execFileSync('git', ['log', '--format=%s', '--', posixPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').filter((line) => HOTFIX_RE.test(line)).length;
  } catch {
    return 0;
  }
}

export function countHotfixMessages(messages: string[]): number {
  return messages.filter((m) => HOTFIX_RE.test(m)).length;
}
