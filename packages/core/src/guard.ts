import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { CHECKS_DIR, checkKeyFor, readStoredCheck } from './check.js';
import { buildImportGraph, toPosix } from './importGraph.js';
import { collectScopeDiff } from './diff.js';
import { readActiveContract, ZONING_DIR } from './contracts.js';
import { DEFAULT_MODEL, llmConfigFromEnv } from './llm.js';
import { loadZonesFile } from './scan.js';
import { resolveZone } from './zones.js';

export interface GuardOptions {
  model?: string;
}

export interface DriveByFile {
  file: string;
  reason?: string;
}

export interface SharedFile {
  file: string;
  importers: string[];
}

export interface GuardResult {
  ok: boolean;
  driveBy: DriveByFile[];
  shared: SharedFile[];
  contractSlug?: string;
  checkNeeded: boolean;
  checkPassed: boolean;
  checkPath?: string;
}

export function stagedFiles(repoRoot: string): string[] {
  let out: string;
  let topLevel: string;
  try {
    const opts: { cwd: string; encoding: 'utf8'; stdio: ['ignore', 'pipe', 'ignore'] } = {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    };
    out = execFileSync('git', ['diff', '--cached', '--name-only', '-z', '--'], opts);
    topLevel = execFileSync('git', ['rev-parse', '--show-toplevel'], opts).trim();
  } catch (err) {
    throw new Error(
      `cannot list staged files in ${repoRoot} (is it a git repo?): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // Staged paths are relative to the git top level; relativize to the
  // target and drop files outside it.
  const root = realpathSync(resolve(repoRoot));
  return out
    .split('\0')
    .map((f) => f.trim())
    .filter((f) => f !== '')
    .map((f) => toPosix(relative(root, resolve(topLevel, f))))
    .filter((f) => f !== '' && !f.startsWith('..'));
}

export function guardModel(env: NodeJS.ProcessEnv = process.env, override?: string): string {
  return override ?? llmConfigFromEnv(env)?.model ?? DEFAULT_MODEL;
}

export function runGuard(repoRoot: string, options: GuardOptions = {}): GuardResult {
  const zones = loadZonesFile(repoRoot);
  if (zones === undefined) {
    throw new Error(
      `no zones.yml in ${repoRoot} — run "zoning scan" and copy zones.suggested.yml to zones.yml first`,
    );
  }
  const active = readActiveContract(repoRoot);
  const scope = active?.contract.in_scope ?? [];
  const staged = stagedFiles(repoRoot);

  const driveBy: DriveByFile[] = [];
  const sharedStaged: string[] = [];
  for (const file of staged) {
    const zone = resolveZone(zones, file);
    if (zone.tier === 'critical' && !scope.includes(file)) {
      driveBy.push({ file, ...(zone.reason !== undefined ? { reason: zone.reason } : {}) });
    } else if (zone.tier === 'shared') {
      sharedStaged.push(file);
    }
  }

  let importersOf = new Map<string, string[]>();
  if (sharedStaged.length > 0) {
    importersOf = buildImportGraph(repoRoot).importersOf;
  }
  const shared: SharedFile[] = sharedStaged.map((file) => ({
    file,
    importers: importersOf.get(file) ?? [],
  }));

  let checkNeeded = false;
  let checkPassed = false;
  let checkPath: string | undefined;
  if (active !== undefined) {
    const diff = collectScopeDiff(repoRoot, scope);
    checkNeeded = !diff.empty;
    if (checkNeeded) {
      const model = guardModel(process.env, options.model);
      const key = checkKeyFor(model, active.slug, active.contract, diff.text);
      const checksDir = join(repoRoot, ZONING_DIR, CHECKS_DIR);
      const stored = readStoredCheck(checksDir, key);
      if (stored !== undefined && stored.slug === active.slug && stored.result.verdict === 'pass') {
        checkPassed = true;
        checkPath = join(checksDir, `${key}.json`);
      }
    }
  }

  return {
    ok: driveBy.length === 0 && (!checkNeeded || checkPassed),
    driveBy,
    shared,
    ...(active !== undefined ? { contractSlug: active.slug } : {}),
    checkNeeded,
    checkPassed,
    ...(checkPath !== undefined ? { checkPath } : {}),
  };
}

export function formatGuardResult(result: GuardResult): string {
  const lines: string[] = [];
  for (const d of result.driveBy) {
    const reason = d.reason === undefined ? 'Critical file' : `Critical file (${d.reason})`;
    const scope =
      result.contractSlug === undefined
        ? 'there is no active contract'
        : `it is not in the active contract (${result.contractSlug})`;
    lines.push(`blocked: ${d.file} — ${reason}, and ${scope}.`);
  }
  if (result.checkNeeded && !result.checkPassed) {
    lines.push(
      `blocked: no passing check for the current diff` +
        (result.contractSlug === undefined ? '' : ` (contract ${result.contractSlug})`) +
        ` — run "zoning check" first.`,
    );
  }
  for (const s of result.shared) {
    const who =
      s.importers.length === 0
        ? 'nothing imports it right now'
        : `imported by ${s.importers.length}: ${s.importers.join(', ')}`;
    lines.push(`warning: ${s.file} is Shared — ${who}.`);
  }
  if (result.ok && result.checkNeeded && result.checkPassed) {
    lines.push(
      `guard: Critical change covered` +
        (result.contractSlug === undefined ? '' : ` by ${result.contractSlug}`) +
        ` with a passing check.`,
    );
  }
  return lines.join('\n');
}
