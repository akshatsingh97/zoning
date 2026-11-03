import { describe, expect, it } from 'vitest';
import {
  buildImportGraph,
  fanIn,
  parseImportSpecifiers,
  resolveRelativeImport,
} from '../src/importGraph';

const SHOP = new URL('../../../tests/fixtures/shop', import.meta.url).pathname;

describe('parseImportSpecifiers', () => {
  it('finds import, export-from and require specifiers', () => {
    const source = [
      "import x from './a.js';",
      'import { y } from "../b";',
      "export * from './c.js';",
      "const z = require('./d.js');",
    ].join('\n');
    expect(parseImportSpecifiers(source)).toEqual(['./a.js', '../b', './c.js', './d.js']);
  });
});

describe('resolveRelativeImport', () => {
  it('maps .js specifiers to .ts files', () => {
    const files = new Set(['packages/utils/pricing.ts']);
    expect(
      resolveRelativeImport('packages/payment/capture.ts', '../utils/pricing.js', files),
    ).toBe('packages/utils/pricing.ts');
  });

  it('ignores bare package imports', () => {
    expect(resolveRelativeImport('a.ts', 'zod', new Set(['a.ts']))).toBeUndefined();
  });
});

describe('buildImportGraph on fixture shop', () => {
  it('computes fan-in with pricing.ts the most imported', () => {
    const graph = buildImportGraph(SHOP);
    expect(graph.files).toContain('packages/utils/pricing.ts');
    expect(fanIn(graph, 'packages/utils/pricing.ts')).toBe(4);
    expect(graph.importersOf.get('packages/utils/pricing.ts')).toEqual([
      'packages/auth/session.ts',
      'packages/cart/cart.ts',
      'packages/payment/capture.ts',
      'packages/payment/checkout.ts',
    ]);
    expect(fanIn(graph, 'packages/utils/format.ts')).toBe(2);
    expect(fanIn(graph, 'packages/payment/capture.ts')).toBe(1);
    expect(fanIn(graph, 'packages/cart/cart.ts')).toBe(0);
  });
});
