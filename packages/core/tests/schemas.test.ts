import { describe, expect, it } from 'vitest';
import {
  CheckResultSchema,
  ContractSchema,
  GapQuestionsSchema,
  SparkTagSchema,
  WatchEventSchema,
  ZonesFileSchema,
} from '../src/schemas';

describe('ZonesFileSchema', () => {
  it('accepts the spec example', () => {
    const parsed = ZonesFileSchema.parse({
      version: 1,
      critical: [{ path: 'packages/payment/**', reason: 'handles money' }],
      shared: [{ path: 'packages/utils/pricing.ts', reason: 'imported by many modules' }],
    });
    expect(parsed.critical).toHaveLength(1);
    expect(parsed.shared).toHaveLength(1);
  });

  it('rejects entries without a reason', () => {
    expect(() =>
      ZonesFileSchema.parse({ version: 1, critical: [{ path: 'a.ts' }], shared: [] }),
    ).toThrow();
  });
});

describe('ContractSchema', () => {
  it('accepts the spec example', () => {
    const parsed = ContractSchema.parse({
      task: 'Add a retry to payment capture',
      in_scope: ['packages/payment/capture.ts'],
      must_change: ['Retry capture on a network error'],
      must_not_change: ['Never charge a customer twice', 'Keep the capture response shape the same'],
    });
    expect(parsed.in_scope).toEqual(['packages/payment/capture.ts']);
  });

  it('rejects an empty scope', () => {
    expect(() => ContractSchema.parse({ task: 'x', in_scope: [] })).toThrow();
  });
});

describe('SparkTagSchema', () => {
  it('accepts the spec shape', () => {
    const parsed = SparkTagSchema.parse({
      handles: ['money', 'permissions'],
      confidence: 'high',
      reason: 'charges cards and checks roles',
    });
    expect(parsed.handles).toEqual(['money', 'permissions']);
  });

  it('rejects unknown handles and missing reasons', () => {
    expect(() =>
      SparkTagSchema.parse({ handles: ['gold'], confidence: 'high', reason: 'x' }),
    ).toThrow();
    expect(() =>
      SparkTagSchema.parse({ handles: ['none'], confidence: 'low', reason: '' }),
    ).toThrow();
  });
});

describe('GapQuestionsSchema', () => {
  it('accepts up to 3 questions and an empty list', () => {
    expect(GapQuestionsSchema.parse({ questions: ['a?', 'b?'] }).questions).toEqual(['a?', 'b?']);
    expect(GapQuestionsSchema.parse({ questions: [] }).questions).toEqual([]);
  });

  it('rejects a missing questions field', () => {
    expect(() => GapQuestionsSchema.parse({})).toThrow();
  });
});

describe('WatchEventSchema', () => {
  it('accepts a full drive-by event', () => {
    const parsed = WatchEventSchema.parse({
      type: 'drive_by',
      file: 'pay/a.ts',
      tier: 'critical',
      reason: 'handles money',
      contractSlug: 'retry',
      at: '2026-10-31T00:00:00.000Z',
    });
    expect(parsed.type).toBe('drive_by');
  });

  it('rejects unknown types and empty files', () => {
    expect(() =>
      WatchEventSchema.parse({ type: 'nope', file: 'a.ts', tier: 'open', at: 't' }),
    ).toThrow();
    expect(() =>
      WatchEventSchema.parse({ type: 'open_change', file: '', tier: 'open', at: 't' }),
    ).toThrow();
  });
});

describe('CheckResultSchema', () => {
  it('accepts the spec shape', () => {
    const parsed = CheckResultSchema.parse({
      verdict: 'fail',
      violations: [
        {
          rule: 'Never charge a customer twice',
          file: 'pay/a.ts',
          line: 12,
          explanation: 'retries with no idempotency key',
        },
      ],
      out_of_scope: ['other.ts'],
    });
    expect(parsed.verdict).toBe('fail');
  });

  it('rejects bad verdicts, non-positive lines and empty rules', () => {
    expect(() =>
      CheckResultSchema.parse({ verdict: 'maybe', violations: [], out_of_scope: [] }),
    ).toThrow();
    expect(() =>
      CheckResultSchema.parse({
        verdict: 'fail',
        violations: [{ rule: 'r', file: 'f', line: 0, explanation: 'e' }],
        out_of_scope: [],
      }),
    ).toThrow();
    expect(() =>
      CheckResultSchema.parse({
        verdict: 'fail',
        violations: [{ rule: '', file: 'f', line: 1, explanation: 'e' }],
        out_of_scope: [],
      }),
    ).toThrow();
  });
});
