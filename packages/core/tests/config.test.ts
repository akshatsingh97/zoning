import { describe, expect, it } from 'vitest';
import { matchPathRule } from '../src/config';

describe('matchPathRule', () => {
  it.each([
    ['packages/payment/capture.ts', 'money'],
    ['packages/billing/invoice.ts', 'money'],
    ['packages/payment/checkout.ts', 'money'],
    ['packages/auth/session.ts', 'auth'],
    ['src/session/store.ts', 'auth'],
    ['src/permissions/roles.ts', 'auth'],
    ['db/migration_001.sql', 'infra'],
    ['terraform/main.tf', 'infra'],
    ['infra/deploy.ts', 'infra'],
    ['.github/workflows/ci.yml', 'infra'],
  ])('matches %s as %s', (path, category) => {
    expect(matchPathRule(path)?.category).toBe(category);
  });

  it.each([['packages/cart/cart.ts'], ['packages/utils/format.ts'], ['README.md']])(
    'leaves %s unmatched',
    (path) => {
      expect(matchPathRule(path)).toBeUndefined();
    },
  );
});
