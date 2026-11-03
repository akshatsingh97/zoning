import { describe, expect, it, vi } from 'vitest';
import {
  classifyChange,
  formatEvent,
  sendEventToServer,
  type ActiveScope,
} from '../src/events';
import type { WatchEvent } from '../src/schemas';

const ACTIVE: ActiveScope = {
  slug: 'retry',
  contract: { task: 't', in_scope: ['pay/a.ts'], must_change: [], must_not_change: [] },
};

describe('classifyChange', () => {
  it.each([
    ['critical' as const, 'pay/a.ts', ACTIVE, 'in_scope_change'],
    ['critical' as const, 'pay/b.ts', ACTIVE, 'drive_by'],
    ['critical' as const, 'pay/a.ts', undefined, 'drive_by'],
    ['shared' as const, 'lib/u.ts', ACTIVE, 'shared_change'],
    ['shared' as const, 'lib/u.ts', undefined, 'shared_change'],
    ['open' as const, 'notes.txt', ACTIVE, 'open_change'],
    ['open' as const, 'notes.txt', undefined, 'open_change'],
  ])('tier=%s file=%s -> %s', (tier, file, active, expected) => {
    expect(classifyChange(tier, file, active)).toBe(expected);
  });
});

describe('formatEvent', () => {
  const base: WatchEvent = { type: 'open_change', file: 'a.ts', tier: 'open', at: 't' };

  it('prints drive-by edits loudly with the file and rule', () => {
    const text = formatEvent({
      ...base,
      type: 'drive_by',
      tier: 'critical',
      file: 'pay/a.ts',
      reason: 'handles money',
    });
    expect(text).toContain('DRIVE-BY');
    expect(text).toContain('pay/a.ts');
    expect(text).toContain('handles money');
    expect(text).toContain('no active contract');
  });

  it('names the contract when one is active but does not cover the file', () => {
    const text = formatEvent({
      ...base,
      type: 'drive_by',
      tier: 'critical',
      file: 'pay/b.ts',
      contractSlug: 'retry',
    });
    expect(text).toContain('retry');
  });

  it('formats in-scope, shared and open events plainly', () => {
    expect(
      formatEvent({ ...base, type: 'in_scope_change', tier: 'critical', contractSlug: 'retry' }),
    ).toContain('in-scope change: a.ts');
    expect(
      formatEvent({
        ...base,
        type: 'shared_change',
        tier: 'shared',
        importers: ['x.ts', 'y.ts'],
      }),
    ).toBe('shared change: a.ts — imported by 2: x.ts, y.ts');
    expect(formatEvent(base)).toBe('open change: a.ts');
  });
});

describe('sendEventToServer', () => {
  const event: WatchEvent = { type: 'open_change', file: 'a.ts', tier: 'open', at: 't' };

  it('POSTs the event JSON and reports success', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }) as Response);
    await expect(
      sendEventToServer('http://localhost:9999/', event, fetchImpl as typeof fetch),
    ).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:9999/events');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(event));
  });

  it('returns false on server errors and network failures', async () => {
    const failing = vi.fn(async () => ({ ok: false }) as Response);
    await expect(
      sendEventToServer('http://localhost:9999', event, failing as typeof fetch),
    ).resolves.toBe(false);
    const broken = vi.fn(async () => {
      throw new Error('connection refused');
    });
    await expect(
      sendEventToServer('http://localhost:9999', event, broken as typeof fetch),
    ).resolves.toBe(false);
  });
});
