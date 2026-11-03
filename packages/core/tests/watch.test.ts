import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setActiveContract, writeContract } from '../src/contracts';
import type { WatchEvent } from '../src/schemas';
import { isIgnoredPath, watchRepo } from '../src/watch';

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zoning-watch-'));
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
  writeFileSync(join(dir, 'payment/capture.ts'), 'export const a = 1;\n', 'utf8');
  writeFileSync(join(dir, 'lib/util.ts'), 'export const u = 1;\n', 'utf8');
  writeFileSync(join(dir, 'app.ts'), "import './lib/util.js';\n", 'utf8');
  writeFileSync(join(dir, 'notes.txt'), 'hello\n', 'utf8');
  return dir;
}

async function waitFor(events: WatchEvent[], count: number, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (events.length < count) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for ${count} events (got ${events.length})`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('isIgnoredPath', () => {
  const root = join('repo');
  it.each([
    [join('repo', '.zoning', 'active.json'), true],
    [join('repo', '.zoning'), true],
    [join('repo', 'node_modules', 'x', 'y.js'), true],
    [join('repo', 'packages', 'a', 'node_modules', 'z.js'), true],
    [join('repo', '.git', 'HEAD'), true],
    [join('repo', 'payment', 'a.ts'), false],
    [join('repo', 'zoning.yml'), false],
    ['repo', false],
  ])('%s -> %s', (path, expected) => {
    expect(isIgnoredPath(root, path)).toBe(expected);
  });
});

describe('watchRepo', () => {
  it(
    'emits drive_by, in_scope_change, shared_change and open_change',
    async () => {
      const dir = setupRepo();
      const events: WatchEvent[] = [];
      const handle = await watchRepo(dir, {
        onEvent: (e) => events.push(e),
        usePolling: true,
        pollIntervalMs: 100,
      });
      try {
        await handle.ready();

        appendFileSync(join(dir, 'payment/capture.ts'), '// edit 1\n');
        await waitFor(events, 1);
        expect(events[0]?.type).toBe('drive_by');
        expect(events[0]?.file).toBe('payment/capture.ts');

        const { slug } = writeContract(dir, {
          task: 'cover capture',
          in_scope: ['payment/capture.ts'],
          must_change: [],
          must_not_change: [],
        });
        setActiveContract(dir, slug);
        appendFileSync(join(dir, 'payment/capture.ts'), '// edit 2\n');
        await waitFor(events, 2);
        expect(events[1]).toMatchObject({
          type: 'in_scope_change',
          file: 'payment/capture.ts',
          contractSlug: slug,
        });

        appendFileSync(join(dir, 'lib/util.ts'), '// edit 3\n');
        await waitFor(events, 3);
        expect(events[2]).toMatchObject({
          type: 'shared_change',
          file: 'lib/util.ts',
          importers: ['app.ts'],
        });

        appendFileSync(join(dir, 'notes.txt'), 'more\n');
        await waitFor(events, 4);
        expect(events[3]).toMatchObject({ type: 'open_change', file: 'notes.txt' });
      } finally {
        await handle.stop();
      }
    },
    25000,
  );

  it('fails fast without a zones.yml', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-watch-'));
    await expect(watchRepo(dir, { onEvent: () => {} })).rejects.toThrow('no zones.yml');
  });
});
