import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { contentHash } from './cache.js';
import { diffFiles, parseDiffLines } from './diff.js';
import { completeJson, type ChatFn } from './llm.js';
import {
  CheckResultSchema,
  type CheckResult,
  type CheckViolation,
  type Contract,
} from './schemas.js';

export const CHECKS_DIR = 'checks';
export const CHECK_PROMPT_VERSION = 'check-v2';

export const CHECK_SYSTEM = [
  'You judge a code diff against an intent contract for a risky change.',
  'The contract lists what must change and what must never change.',
  'The must_not_change rules are absolute: judge the diff against the rules as written,',
  'even if the surrounding code looks like a stub, fake, or test double.',
  'In particular, a retry loop over a charge, capture, or payment operation breaks a no-double-charge rule',
  'unless the diff itself adds an idempotency safeguard (idempotency key, exactly-once guard, or deduplication check).',
  'Reply with JSON only: {"verdict": "pass|fail", "violations": [{"rule": "...", "file": "...", "line": 0, "explanation": "..."}], "out_of_scope": [...]}.',
  'Each violation cites the exact contract rule it breaks, the file, and the new-file line number from the diff hunk header where the breaking code sits.',
  'List in out_of_scope any changed file that is not in the contract scope.',
  'Fail only on real rule breaks you can point at; an empty violations list means verdict pass.',
].join(' ');

export function checkPromptFor(contract: Contract, diffText: string): string {
  return `Intent contract:\n${stringify(contract).trimEnd()}\n\n---\n\nDiff (new-file line numbers):\n${diffText}`;
}

export function checkKeyFor(
  model: string,
  slug: string,
  contract: Contract,
  diffText: string,
): string {
  return `${CHECK_PROMPT_VERSION}-${model}-${contentHash(`${slug}\n${stringify(contract)}\n${diffText}`)}`;
}

export interface FilteredViolations {
  kept: CheckViolation[];
  dropped: CheckViolation[];
}

export function filterViolations(
  violations: CheckViolation[],
  diffText: string,
): FilteredViolations {
  const validLines = parseDiffLines(diffText);
  const kept: CheckViolation[] = [];
  const dropped: CheckViolation[] = [];
  for (const v of violations) {
    const file = v.file.replace(/^\.\/+/g, '');
    if (validLines.has(`${file}:${v.line}`)) kept.push({ ...v, file });
    else dropped.push(v);
  }
  return { kept, dropped };
}

export function filterOutOfScope(outOfScope: string[], diffText: string): string[] {
  const files = new Set(diffFiles(diffText));
  return [...new Set(outOfScope.map((f) => f.replace(/^\.\/+/g, '')))].filter((f) => files.has(f));
}

export interface StoredCheck {
  key: string;
  slug: string;
  result: CheckResult;
  at: string;
}

export function readStoredCheck(checksDir: string, key: string): StoredCheck | undefined {
  try {
    const raw = readFileSync(join(checksDir, `${key}.json`), 'utf8');
    const parsed = JSON.parse(raw) as { slug: unknown; result: unknown; at: unknown };
    const result = CheckResultSchema.safeParse(parsed.result);
    if (!result.success || typeof parsed.slug !== 'string' || typeof parsed.at !== 'string') {
      return undefined;
    }
    return { key, slug: parsed.slug, result: result.data, at: parsed.at };
  } catch {
    return undefined;
  }
}

export function writeStoredCheck(
  checksDir: string,
  key: string,
  slug: string,
  result: CheckResult,
): string {
  mkdirSync(checksDir, { recursive: true });
  const path = join(checksDir, `${key}.json`);
  const stored: StoredCheck = { key, slug, result, at: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(stored), 'utf8');
  return path;
}

export const EMPTY_CHECK: CheckResult = { verdict: 'pass', violations: [], out_of_scope: [] };

export interface CheckRun {
  result: CheckResult;
  cached: boolean;
  dropped: number;
  path: string;
}

export async function runCheck(
  chat: ChatFn,
  model: string,
  checksDir: string,
  slug: string,
  contract: Contract,
  diffText: string,
): Promise<CheckRun> {
  const key = checkKeyFor(model, slug, contract, diffText);
  const hit = readStoredCheck(checksDir, key);
  if (hit !== undefined && hit.slug === slug) {
    return {
      result: hit.result,
      cached: true,
      dropped: 0,
      path: join(checksDir, `${key}.json`),
    };
  }
  if (diffText.trim() === '') {
    const path = writeStoredCheck(checksDir, key, slug, EMPTY_CHECK);
    return { result: EMPTY_CHECK, cached: false, dropped: 0, path };
  }
  const raw = await completeJson(chat, CHECK_SYSTEM, checkPromptFor(contract, diffText), CheckResultSchema);
  const { kept, dropped } = filterViolations(raw.violations, diffText);
  // Fail-closed: kept violations always fail; otherwise trust the model's verdict.
  const result: CheckResult = {
    verdict: kept.length > 0 ? 'fail' : raw.verdict,
    violations: kept,
    out_of_scope: filterOutOfScope(raw.out_of_scope, diffText),
  };
  const path = writeStoredCheck(checksDir, key, slug, result);
  return { result, cached: false, dropped: dropped.length, path };
}
