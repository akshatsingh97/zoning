import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runInit } from '../src/init';

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
}

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zoning-init-'));
  git(dir, ['init', '-q']);
  mkdirSync(join(dir, 'payment'), { recursive: true });
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'payment', 'capture.ts'), 'export const a = 1;\n', 'utf8');
  writeFileSync(join(dir, 'lib', 'util.ts'), 'export const u = 1;\n', 'utf8');
  writeFileSync(join(dir, 'app.ts'), "import './lib/util.js';\n", 'utf8');
  return dir;
}

describe('runInit', () => {
  it('writes suggested zones, hook and skill without model calls', async () => {
    const dir = setupRepo();
    const result = await runInit(dir, { cliEntryAbs: '/cli/index.js', includeHotfixes: false });
    expect(result.counts.critical).toBe(1);
    expect(result.tagged).toBeUndefined();
    expect(readFileSync(result.suggestedPath, 'utf8')).toContain('payment/capture.ts');
    expect(result.suggestedPath).toBe(join(dir, 'zones.suggested.yml'));
    expect(result.hookCreated).toBe(true);
    expect(readFileSync(result.hookPath, 'utf8')).toContain('guard "$REPO"');
    expect(result.skillCreated).toBe(true);
    const skill = readFileSync(result.skillPath, 'utf8');
    expect(result.skillPath).toBe(join(dir, '.agents', 'skills', 'zoning', 'SKILL.md'));
    expect(skill).toContain('zoning zone <file>');
    expect(skill).toContain('STOP');
    expect(skill).toContain('zoning contract new');
  });

  it('tags with spark when provided and reruns idempotently', async () => {
    const dir = setupRepo();
    const moneyHigh = JSON.stringify({ handles: ['money'], confidence: 'high', reason: 'm' });
    const chat = vi.fn(async () => moneyHigh);
    const first = await runInit(dir, {
      cliEntryAbs: '/cli/index.js',
      includeHotfixes: false,
      spark: { chat, model: 'm' },
    });
    expect(first.tagged?.tagged).toBeGreaterThan(0);
    expect(chat).toHaveBeenCalled();
    const second = await runInit(dir, { cliEntryAbs: '/cli/index.js', includeHotfixes: false });
    expect(second.hookCreated).toBe(false);
    expect(second.skillCreated).toBe(false);
  });

  it('refuses a foreign skill file and leaves it untouched', async () => {
    const dir = setupRepo();
    const skillPath = join(dir, '.agents', 'skills', 'zoning', 'SKILL.md');
    mkdirSync(join(dir, '.agents', 'skills', 'zoning'), { recursive: true });
    writeFileSync(skillPath, '# Mine\n', 'utf8');
    await expect(runInit(dir, { cliEntryAbs: '/cli/index.js' })).rejects.toThrow(
      'already exists',
    );
    expect(readFileSync(skillPath, 'utf8')).toBe('# Mine\n');
  });
});
