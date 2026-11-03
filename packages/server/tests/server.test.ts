import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHECKS_DIR,
  setActiveContract,
  writeContract,
  writeGapQuestions,
  writeStoredCheck,
  ZONING_DIR,
} from '@zoning/core';
import { buildServer } from '../src/server';

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zoning-server-'));
  mkdirSync(join(dir, 'payment'), { recursive: true });
  mkdirSync(join(dir, 'lib'), { recursive: true });
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
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
  writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'jobs: {}\n', 'utf8');
  return dir;
}

describe('GET /zones', () => {
  it('tiers every repo file with counts', async () => {
    const { app } = buildServer(setupRepo());
    const res = await app.inject({ method: 'GET', url: '/zones' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      files: { file: string; tier: string; reason?: string }[];
      counts: { critical: number; shared: number; open: number };
    };
    const tiers = new Map(body.files.map((f) => [f.file, f.tier]));
    expect(tiers.get('payment/capture.ts')).toBe('critical');
    expect(tiers.get('lib/util.ts')).toBe('shared');
    expect(tiers.get('notes.txt')).toBe('open');
    expect(tiers.get('.github/workflows/ci.yml')).toBe('open');
    expect(body.counts).toEqual({ critical: 1, shared: 1, open: body.files.length - 2 });
    expect(body.files.find((f) => f.file === 'payment/capture.ts')?.reason).toBe('handles money');
    await app.close();
  });
});

describe('GET /blast-radius', () => {
  it('returns tier, reason and importers', async () => {
    const { app } = buildServer(setupRepo());
    const res = await app.inject({ method: 'GET', url: '/blast-radius?file=lib/util.ts' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      file: 'lib/util.ts',
      tier: 'shared',
      reason: 'imported by many modules',
      importers: ['app.ts'],
    });
    await app.close();
  });

  it('rejects missing and unknown files', async () => {
    const { app } = buildServer(setupRepo());
    expect((await app.inject({ method: 'GET', url: '/blast-radius' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/blast-radius?file=ghost.ts' })).statusCode).toBe(
      404,
    );
    await app.close();
  });
});

describe('POST /events', () => {
  it('accepts valid events into the hub and rejects junk', async () => {
    const { app, hub } = buildServer(setupRepo());
    const good = await app.inject({
      method: 'POST',
      url: '/events',
      payload: { type: 'drive_by', file: 'payment/capture.ts', tier: 'critical', at: 't' },
    });
    expect(good.statusCode).toBe(200);
    expect(hub.recent()).toHaveLength(1);
    const bad = await app.inject({
      method: 'POST',
      url: '/events',
      payload: { type: 'nope', file: 'a.ts' },
    });
    expect(bad.statusCode).toBe(400);
    expect(hub.recent()).toHaveLength(1);
    await app.close();
  });
});

describe('GET /checks', () => {
  it('lists stored checks newest first', async () => {
    const dir = setupRepo();
    const { app } = buildServer(dir);
    expect((await app.inject({ method: 'GET', url: '/checks' })).json()).toEqual({ checks: [] });
    const checksDir = join(dir, ZONING_DIR, CHECKS_DIR);
    writeStoredCheck(checksDir, 'k1', 's', { verdict: 'pass', violations: [], out_of_scope: [] });
    const res = await app.inject({ method: 'GET', url: '/checks' });
    const body = res.json() as { checks: { slug: string; result: { verdict: string } }[] };
    expect(body.checks).toHaveLength(1);
    expect(body.checks[0]?.result.verdict).toBe('pass');
    await app.close();
  });
});

describe('GET /contract', () => {
  it('returns null when nothing is active', async () => {
    const { app } = buildServer(setupRepo());
    expect((await app.inject({ method: 'GET', url: '/contract' })).json()).toEqual({
      active: null,
      gapQuestions: [],
    });
    await app.close();
  });

  it('returns the active contract with its gap questions', async () => {
    const dir = setupRepo();
    const { slug } = writeContract(dir, {
      task: 'tune notes',
      in_scope: ['notes.txt'],
      must_change: [],
      must_not_change: [],
    });
    setActiveContract(dir, slug);
    writeGapQuestions(dir, slug, ['Why?']);

    const { app } = buildServer(dir);
    const body = (await app.inject({ method: 'GET', url: '/contract' })).json() as {
      active: { slug: string; contract: { task: string } };
      gapQuestions: string[];
    };
    expect(body.active.slug).toBe(slug);
    expect(body.active.contract.task).toBe('tune notes');
    expect(body.gapQuestions).toEqual(['Why?']);
    await app.close();
  });
});

describe('static dashboard', () => {
  it('serves index.html and assets, 404s unknown assets', async () => {
    const staticDir = mkdtempSync(join(tmpdir(), 'zoning-dist-'));
    writeFileSync(join(staticDir, 'index.html'), '<h1>hi</h1>', 'utf8');
    writeFileSync(join(staticDir, 'app.css'), 'h1{}', 'utf8');
    const { app } = buildServer(setupRepo(), { staticDir });
    const index = await app.inject({ method: 'GET', url: '/' });
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('<h1>hi</h1>');
    const css = await app.inject({ method: 'GET', url: '/app.css' });
    expect(css.statusCode).toBe(200);
    expect(css.headers['content-type']).toContain('text/css');
    expect((await app.inject({ method: 'GET', url: '/missing.js' })).statusCode).toBe(404);
    await app.close();
  });

  it('explains a missing dashboard build', async () => {
    const staticDir = mkdtempSync(join(tmpdir(), 'zoning-dist-'));
    const { app } = buildServer(setupRepo(), { staticDir });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('pnpm build');
    await app.close();
  });
});
