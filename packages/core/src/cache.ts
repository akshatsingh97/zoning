import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ZodType } from 'zod';

export const CACHE_DIR = 'cache';

export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export interface JsonCache<T> {
  read(key: string): T | undefined;
  write(key: string, value: T): void;
}

export function findCacheKey(cacheDir: string, prefix: string, hash: string): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(cacheDir);
  } catch {
    return undefined;
  }
  const found = entries
    .filter((e) => e.endsWith('.json'))
    .map((e) => e.slice(0, -'.json'.length))
    .filter((k) => k.startsWith(`${prefix}-`) && k.endsWith(`-${hash}`))
    .sort();
  return found[0];
}

export function fileJsonCache<T>(cacheDir: string, schema: ZodType<T>): JsonCache<T> {
  return {
    read(key: string): T | undefined {
      try {
        const raw = readFileSync(join(cacheDir, `${key}.json`), 'utf8');
        const parsed = JSON.parse(raw) as { value: unknown };
        const result = schema.safeParse(parsed.value);
        return result.success ? result.data : undefined;
      } catch {
        return undefined;
      }
    },
    write(key: string, value: T): void {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(join(cacheDir, `${key}.json`), JSON.stringify({ key, value }), 'utf8');
    },
  };
}
