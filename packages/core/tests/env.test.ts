import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDotEnv, parseDotEnv } from '../src/env';

describe('parseDotEnv', () => {
  it('parses assignments and skips comments and blanks', () => {
    expect(
      parseDotEnv('# comment\n\nMODEL_API_KEY=abc\nZONING_MODEL=muse-spark-1.3\n'),
    ).toEqual({ MODEL_API_KEY: 'abc', ZONING_MODEL: 'muse-spark-1.3' });
  });

  it('strips surrounding quotes and skips lines without =', () => {
    expect(parseDotEnv('A="quoted value"\nB=\'single\'\nnotaassignment\n=empty\n')).toEqual({
      A: 'quoted value',
      B: 'single',
    });
  });
});

describe('loadDotEnv', () => {
  it('loads keys without clobbering existing env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-env-'));
    writeFileSync(join(dir, '.env'), 'MODEL_API_KEY=from-file\nZONING_MODEL=from-file\n', 'utf8');
    const env: NodeJS.ProcessEnv = { ZONING_MODEL: 'already-set' };
    loadDotEnv(dir, env);
    expect(env.MODEL_API_KEY).toBe('from-file');
    expect(env.ZONING_MODEL).toBe('already-set');
  });

  it('does nothing when .env is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-env-'));
    const env: NodeJS.ProcessEnv = {};
    loadDotEnv(dir, env);
    expect(env).toEqual({});
  });
});
