import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  checkKeyFor,
  checkPromptFor,
  EMPTY_CHECK,
  filterOutOfScope,
  filterViolations,
  runCheck,
} from '../src/check';

const CONTRACT = {
  task: 'Add a retry to payment capture',
  in_scope: ['pay/a.ts'],
  must_change: ['Retry capture on a network error'],
  must_not_change: ['Never charge a customer twice'],
};

const DIFF = [
  'diff --git a/pay/a.ts b/pay/a.ts',
  '--- a/pay/a.ts',
  '+++ b/pay/a.ts',
  '@@ -1,2 +1,3 @@',
  ' const x = 1;',
  '+retry();',
  ' const y = 2;',
  '',
].join('\n');

describe('checkPromptFor', () => {
  it('includes the contract rules and the diff', () => {
    const prompt = checkPromptFor(CONTRACT, DIFF);
    expect(prompt).toContain('Never charge a customer twice');
    expect(prompt).toContain('retry();');
    expect(prompt).toContain('@@ -1,2 +1,3 @@');
  });
});

describe('checkKeyFor', () => {
  it('is stable and sensitive to model, contract and diff', () => {
    const key = checkKeyFor('m', 's', CONTRACT, DIFF);
    expect(checkKeyFor('m', 's', CONTRACT, DIFF)).toBe(key);
    expect(checkKeyFor('other', 's', CONTRACT, DIFF)).not.toBe(key);
    expect(checkKeyFor('m', 's', { ...CONTRACT, task: 'x' }, DIFF)).not.toBe(key);
    expect(checkKeyFor('m', 's', CONTRACT, DIFF + ' ')).not.toBe(key);
  });
});

describe('filterViolations', () => {
  it('keeps in-diff citations and drops the rest', () => {
    const { kept, dropped } = filterViolations(
      [
        { rule: 'r', file: './pay/a.ts', line: 2, explanation: 'bad retry' },
        { rule: 'r', file: 'pay/a.ts', line: 99, explanation: 'no such line' },
        { rule: 'r', file: 'other.ts', line: 1, explanation: 'no such file' },
      ],
      DIFF,
    );
    expect(kept).toEqual([{ rule: 'r', file: 'pay/a.ts', line: 2, explanation: 'bad retry' }]);
    expect(dropped).toHaveLength(2);
  });
});

describe('filterOutOfScope', () => {
  it('keeps only files present in the diff', () => {
    expect(filterOutOfScope(['pay/a.ts', './pay/a.ts', 'ghost.ts'], DIFF)).toEqual(['pay/a.ts']);
  });
});

describe('runCheck', () => {
  function stubChat(response: string) {
    return vi.fn(async () => response);
  }

  const FAIL = JSON.stringify({
    verdict: 'fail',
    violations: [
      {
        rule: 'Never charge a customer twice',
        file: 'pay/a.ts',
        line: 2,
        explanation: 'retries with no idempotency key',
      },
    ],
    out_of_scope: [],
  });

  it('stores a failing judgment and replays it from disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-check-'));
    const chat = stubChat(FAIL);
    const first = await runCheck(chat, 'm', dir, 's', CONTRACT, DIFF);
    expect(first.result.verdict).toBe('fail');
    expect(first.result.violations).toHaveLength(1);
    expect(first.cached).toBe(false);
    expect(first.dropped).toBe(0);
    expect(readdirSync(dir)).toHaveLength(1);

    const second = await runCheck(chat, 'm', dir, 's', CONTRACT, DIFF);
    expect(second.cached).toBe(true);
    expect(second.result).toEqual(first.result);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('stays failed when every citation falls outside the diff', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-check-'));
    const chat = stubChat(
      JSON.stringify({
        verdict: 'fail',
        violations: [{ rule: 'r', file: 'pay/a.ts', line: 99, explanation: 'x' }],
        out_of_scope: [],
      }),
    );
    const run = await runCheck(chat, 'm', dir, 's', CONTRACT, DIFF);
    expect(run.result.verdict).toBe('fail');
    expect(run.result.violations).toEqual([]);
    expect(run.dropped).toBe(1);
  });

  it('fails when the model cites a real line but calls it a pass', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-check-'));
    const chat = stubChat(
      JSON.stringify({
        verdict: 'pass',
        violations: [{ rule: 'r', file: 'pay/a.ts', line: 2, explanation: 'x' }],
        out_of_scope: [],
      }),
    );
    const run = await runCheck(chat, 'm', dir, 's', CONTRACT, DIFF);
    expect(run.result.verdict).toBe('fail');
  });

  it('passes an empty diff without calling the model', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-check-'));
    const chat = stubChat(FAIL);
    const run = await runCheck(chat, 'm', dir, 's', CONTRACT, '  \n');
    expect(run.result).toEqual(EMPTY_CHECK);
    expect(chat).not.toHaveBeenCalled();
  });

  it('treats a corrupt stored check as a miss', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoning-check-'));
    const chat = stubChat(JSON.stringify({ verdict: 'pass', violations: [], out_of_scope: [] }));
    const first = await runCheck(chat, 'm', dir, 's', CONTRACT, DIFF);
    expect(chat).toHaveBeenCalledTimes(1);
    writeFileSync(first.path, 'corrupt', 'utf8');
    await runCheck(chat, 'm', dir, 's', CONTRACT, DIFF);
    expect(chat).toHaveBeenCalledTimes(2);
  });
});
