import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setActiveContract, writeContract } from '../src/contracts';
import { describeZone, matchZonePattern, resolveZone } from '../src/zones';

describe('matchZonePattern', () => {
  it.each([
    ['packages/payment/capture.ts', 'packages/payment/capture.ts', true],
    ['packages/payment/capture.ts', 'packages/payment/other.ts', false],
    ['packages/payment/**', 'packages/payment/capture.ts', true],
    ['packages/payment/**', 'packages/payment/deep/nested.ts', true],
    ['packages/payment/**', 'packages/cart/cart.ts', false],
    ['packages/*.ts', 'packages/a.ts', true],
    ['packages/*.ts', 'packages/sub/a.ts', false],
    ['packages/**/a.ts', 'packages/a.ts', true],
    ['packages/**/a.ts', 'packages/x/y/a.ts', true],
    ['packages/ab?.ts', 'packages/abc.ts', true],
    ['packages/ab?.ts', 'packages/abcd.ts', false],
    ['./packages/a.ts', 'packages/a.ts', true],
    ['packages/a.ts', './packages/a.ts', true],
  ])('pattern %j vs %j -> %s', (pattern, file, expected) => {
    expect(matchZonePattern(pattern, file)).toBe(expected);
  });
});

describe('resolveZone', () => {
  const zones = {
    version: 1 as const,
    critical: [{ path: 'packages/payment/**', reason: 'handles money' }],
    shared: [
      { path: 'packages/utils/pricing.ts', reason: 'imported by many modules' },
      { path: 'packages/payment/**', reason: 'also shared?' },
    ],
  };

  it('resolves critical, shared and open with reasons', () => {
    expect(resolveZone(zones, 'packages/payment/capture.ts')).toEqual({
      tier: 'critical',
      reason: 'handles money',
      pattern: 'packages/payment/**',
    });
    expect(resolveZone(zones, 'packages/utils/pricing.ts').tier).toBe('shared');
    expect(resolveZone(zones, 'packages/cart/cart.ts')).toEqual({ tier: 'open' });
  });

  it('prefers critical when a path matches both tiers', () => {
    expect(resolveZone(zones, 'packages/payment/x.ts').tier).toBe('critical');
  });
});

describe('describeZone', () => {
  function setup(): string {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-describe-'));
    writeFileSync(
      join(dir, 'zones.yml'),
      'version: 1\ncritical:\n  - path: pay/**\n    reason: handles money\nshared:\n  - path: lib/u.ts\n    reason: widely imported\n',
      'utf8',
    );
    return dir;
  }

  it('reports tier, reason and contract coverage', () => {
    const dir = setup();
    const { slug } = writeContract(dir, {
      task: 't',
      in_scope: ['pay/a.ts'],
      must_change: [],
      must_not_change: [],
    });
    setActiveContract(dir, slug);
    expect(describeZone(dir, 'pay/a.ts')).toEqual({
      file: 'pay/a.ts',
      tier: 'critical',
      reason: 'handles money',
      contractSlug: slug,
      inScope: true,
    });
    expect(describeZone(dir, 'pay/b.ts')).toMatchObject({ tier: 'critical', inScope: false });
    expect(describeZone(dir, 'lib/u.ts')).toMatchObject({ tier: 'shared', inScope: false });
    expect(describeZone(dir, 'notes.txt')).toEqual({
      file: 'notes.txt',
      tier: 'open',
      contractSlug: slug,
      inScope: false,
    });
  });

  it('works without a contract and strips leading ./', () => {
    const dir = setup();
    expect(describeZone(dir, './pay/a.ts')).toEqual({
      file: 'pay/a.ts',
      tier: 'critical',
      reason: 'handles money',
      inScope: false,
    });
  });

  it('throws without zones.yml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-describe-'));
    expect(() => describeZone(dir, 'a.ts')).toThrow('no zones.yml');
  });
});
