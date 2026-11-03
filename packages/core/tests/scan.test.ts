import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { decideTier } from '../src/scan';
import { scanRepo, scanRepoWithTags, writeSuggestedZones } from '../src/scan';

const SHOP = new URL('../../../tests/fixtures/shop', import.meta.url).pathname;

describe('decideTier', () => {
  it('prefers critical over shared when both signals fire', () => {
    expect(
      decideTier({ fanIn: 10, matchedRule: { pattern: /x/, category: 'money', label: 'money' } }, {
        sharedFanIn: 3,
        sparkTopN: 20,
      }),
    ).toBe('critical');
  });

  it('marks high fan-in as shared and the rest as open', () => {
    expect(decideTier({ fanIn: 3, matchedRule: undefined }, { sharedFanIn: 3, sparkTopN: 20 })).toBe(
      'shared',
    );
    expect(decideTier({ fanIn: 2, matchedRule: undefined }, { sharedFanIn: 3, sparkTopN: 20 })).toBe(
      'open',
    );
  });
});

describe('scanRepo on fixture shop', () => {
  it('puts payment and auth files in critical and the most-imported util in shared', () => {
    const { files, zones } = scanRepo(SHOP, { includeHotfixes: false });
    const tierOf = new Map(files.map((f) => [f.file, f.tier]));
    expect(tierOf.get('packages/payment/capture.ts')).toBe('critical');
    expect(tierOf.get('packages/payment/checkout.ts')).toBe('critical');
    expect(tierOf.get('packages/auth/session.ts')).toBe('critical');
    expect(tierOf.get('packages/utils/pricing.ts')).toBe('shared');
    expect(tierOf.get('packages/cart/cart.ts')).toBe('open');
    expect(tierOf.get('packages/utils/format.ts')).toBe('open');

    const paths = (entries: { path: string }[]) => entries.map((e) => e.path).sort();
    expect(paths(zones.critical)).toEqual([
      'packages/auth/session.ts',
      'packages/payment/capture.ts',
      'packages/payment/checkout.ts',
    ]);
    expect(paths(zones.shared)).toEqual(['packages/utils/pricing.ts']);
    for (const entry of [...zones.critical, ...zones.shared]) {
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('scanRepoWithTags', () => {
  const moneyHigh = JSON.stringify({
    handles: ['money'],
    confidence: 'high',
    reason: 'moves money',
  });
  const noneLow = JSON.stringify({ handles: ['none'], confidence: 'low', reason: 'plain helper' });

  function stubChat(seen: string[]) {
    return vi.fn(async (_system: string, user: string) => {
      seen.push(user);
      return user.includes('pricing.ts') ? moneyHigh : noneLow;
    });
  }

  it('upgrades a shared file tagged money/high to critical', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-tags-'));
    const seen: string[] = [];
    const result = await scanRepoWithTags(
      SHOP,
      { includeHotfixes: false },
      { chat: stubChat(seen), model: 'test-model', cacheDir: dir },
    );
    const tierOf = new Map(result.files.map((f) => [f.file, f.tier]));
    expect(tierOf.get('packages/utils/pricing.ts')).toBe('critical');
    expect(result.zones.shared).toEqual([]);
    expect(result.zones.critical.map((e) => e.path)).toContain('packages/utils/pricing.ts');
    expect(result.tagged).toBe(4);
    expect(result.cacheHits).toBe(0);
  });

  it('makes zero model calls on the second run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-tags-'));
    const seen: string[] = [];
    const chat = stubChat(seen);
    const first = await scanRepoWithTags(
      SHOP,
      { includeHotfixes: false },
      { chat, model: 'test-model', cacheDir: dir },
    );
    const callsAfterFirst = chat.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);
    const second = await scanRepoWithTags(
      SHOP,
      { includeHotfixes: false },
      { chat, model: 'test-model', cacheDir: dir },
    );
    expect(chat.mock.calls.length).toBe(callsAfterFirst);
    expect(second.cacheHits).toBe(first.tagged);
    expect(second.zones).toEqual(first.zones);
  });

  it('never sends open files to the model and respects the cap', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-tags-'));
    const seen: string[] = [];
    const result = await scanRepoWithTags(
      SHOP,
      { includeHotfixes: false },
      { chat: stubChat(seen), model: 'test-model', cacheDir: dir, topN: 2 },
    );
    expect(result.tagged).toBe(2);
    expect(seen).toHaveLength(2);
    for (const prompt of seen) {
      expect(prompt).not.toContain('cart.ts');
      expect(prompt).not.toContain('format.ts');
    }
  });
});

describe('writeSuggestedZones', () => {
  it('writes suggested zones without touching zones.yml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-scan-'));
    const { zones } = scanRepo(SHOP, { includeHotfixes: false });
    const outPath = writeSuggestedZones(dir, zones);
    expect(outPath).toBe(join(dir, 'zones.suggested.yml'));
    const text = readFileSync(outPath, 'utf8');
    expect(text).toContain('packages/payment/capture.ts');
    expect(text).toContain('reason:');
    expect(() => readFileSync(join(dir, 'zones.yml'), 'utf8')).toThrow();
  });
});
