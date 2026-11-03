import { describe, expect, it } from 'vitest';
import { countHotfixMessages } from '../src/history';

describe('countHotfixMessages', () => {
  it('counts fix, hotfix and revert messages case-insensitively', () => {
    const messages = [
      'fix: retry capture',
      'HOTFIX: double charge',
      'Revert "add retry"',
      'feat: add cart page',
      'docs: update readme',
    ];
    expect(countHotfixMessages(messages)).toBe(3);
  });

  it('returns 0 when nothing matches', () => {
    expect(countHotfixMessages(['feat: add cart', 'chore: bump'])).toBe(0);
  });
});
