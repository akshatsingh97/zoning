import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse, stringify } from 'yaml';
import {
  ActiveContractSchema,
  ContractSchema,
  GapQuestionsSchema,
  type Contract,
} from './schemas.js';

export const ZONING_DIR = '.zoning';
export const CONTRACTS_DIR = 'contracts';
export const ACTIVE_FILE = 'active.json';
export const GAPS_SUFFIX = '.gaps.json';

export function contractSlug(task: string): string {
  const slug = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug === '' ? 'contract' : slug;
}

export function dedupeSlug(existing: string[], base: string): string {
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function contractsDir(repoRoot: string): string {
  return join(repoRoot, ZONING_DIR, CONTRACTS_DIR);
}

function existingSlugs(repoRoot: string): string[] {
  try {
    return readdirSync(contractsDir(repoRoot))
      .filter((f) => f.endsWith('.yml'))
      .map((f) => f.slice(0, -'.yml'.length));
  } catch {
    return [];
  }
}

export function normalizeScopePath(file: string): string {
  return file
    .trim()
    .replace(/^\.\/+/g, '')
    .replace(/\\/g, '/');
}

export function resolveScopeFile(repoRoot: string, file: string): string {
  const stored = normalizeScopePath(file);
  if (stored === '' || isAbsolute(file)) {
    throw new Error(`in-scope file must be relative to the repo: ${file}`);
  }
  const abs = resolve(repoRoot, stored);
  const rel = relative(resolve(repoRoot), abs);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`in-scope file is outside the repo: ${file}`);
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    throw new Error(`in-scope file not found: ${file}`);
  }
  return abs;
}

export interface WrittenContract {
  slug: string;
  path: string;
}

export function writeContract(repoRoot: string, contract: Contract): WrittenContract {
  const parsed = ContractSchema.parse(contract);
  const dir = contractsDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  const slug = dedupeSlug(existingSlugs(repoRoot), contractSlug(parsed.task));
  const path = join(dir, `${slug}.yml`);
  writeFileSync(path, stringify(parsed), 'utf8');
  return { slug, path };
}

export function setActiveContract(repoRoot: string, slug: string): string {
  const dir = join(repoRoot, ZONING_DIR);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, ACTIVE_FILE);
  writeFileSync(path, `${JSON.stringify({ slug })}\n`, 'utf8');
  return path;
}

export function writeGapQuestions(repoRoot: string, slug: string, questions: string[]): string {
  const parsed = GapQuestionsSchema.parse({ questions });
  const path = join(contractsDir(repoRoot), `${slug}${GAPS_SUFFIX}`);
  mkdirSync(contractsDir(repoRoot), { recursive: true });
  writeFileSync(path, JSON.stringify(parsed), 'utf8');
  return path;
}

export function readGapQuestions(repoRoot: string, slug: string): string[] | undefined {
  try {
    const raw = readFileSync(join(contractsDir(repoRoot), `${slug}${GAPS_SUFFIX}`), 'utf8');
    return GapQuestionsSchema.parse(JSON.parse(raw)).questions;
  } catch {
    return undefined;
  }
}

export interface ActiveContractData {
  slug: string;
  contract: Contract;
  path: string;
}

export function readActiveContract(repoRoot: string): ActiveContractData | undefined {
  try {
    const active = ActiveContractSchema.parse(
      JSON.parse(readFileSync(join(repoRoot, ZONING_DIR, ACTIVE_FILE), 'utf8')),
    );
    const path = join(contractsDir(repoRoot), `${active.slug}.yml`);
    const contract = ContractSchema.parse(parse(readFileSync(path, 'utf8')));
    return { slug: active.slug, contract, path };
  } catch {
    return undefined;
  }
}
