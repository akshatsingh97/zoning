import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import {
  DEFAULT_PATH_RULES,
  DEFAULT_THRESHOLDS,
  matchPathRule,
  type PathRule,
  type ScanThresholds,
  type ZoneTier,
} from './config.js';
import { buildImportGraph, fanIn } from './importGraph.js';
import { hotfixCount } from './history.js';
import { CACHE_DIR } from './cache.js';
import { ZONING_DIR } from './contracts.js';
import { type ChatFn } from './llm.js';
import { ZonesFileSchema, type SparkTag, type ZonesFile } from './schemas.js';
import {
  fileTagCache,
  selectTagCandidates,
  tagFile,
  tagUpgradesToCritical,
} from './tag.js';

export interface FileSignals {
  file: string;
  fanIn: number;
  importers: string[];
  matchedRule?: PathRule;
  hotfixes: number;
}

export interface ScannedFile extends FileSignals {
  tier: ZoneTier;
  reason: string;
  tag?: SparkTag;
}

export interface ScanOptions {
  rules?: PathRule[];
  thresholds?: Partial<ScanThresholds>;
  includeHotfixes?: boolean;
}

export function decideTier(signals: Pick<FileSignals, 'fanIn' | 'matchedRule'>, thresholds: ScanThresholds): ZoneTier {
  if (signals.matchedRule !== undefined) return 'critical';
  if (signals.fanIn >= thresholds.sharedFanIn) return 'shared';
  return 'open';
}

export function reasonFor(signals: FileSignals, tier: ZoneTier): string {
  const parts: string[] = [];
  if (signals.matchedRule) {
    parts.push(`path rule: ${signals.matchedRule.label} (${signals.matchedRule.category})`);
  }
  if (tier === 'shared' || signals.fanIn > 0) {
    parts.push(`imported by ${signals.fanIn} file${signals.fanIn === 1 ? '' : 's'}`);
  }
  if (signals.hotfixes > 0) {
    parts.push(`${signals.hotfixes} hotfix${signals.hotfixes === 1 ? '' : 'es'} in history`);
  }
  if (parts.length === 0) return 'no signals';
  return parts.join('; ');
}

export interface ScanResult {
  files: ScannedFile[];
  zones: ZonesFile;
}

export function scanRepo(repoRoot: string, options: ScanOptions = {}): ScanResult {
  const rules = options.rules ?? DEFAULT_PATH_RULES;
  const thresholds: ScanThresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const graph = buildImportGraph(repoRoot);
  const files: ScannedFile[] = graph.files.map((file) => {
    const matchedRule = matchPathRule(file, rules);
    const importers = graph.importersOf.get(file) ?? [];
    const signals: FileSignals = {
      file,
      fanIn: fanIn(graph, file),
      importers,
      matchedRule,
      hotfixes: options.includeHotfixes === false ? 0 : hotfixCount(repoRoot, file),
    };
    const tier = decideTier(signals, thresholds);
    return { ...signals, tier, reason: reasonFor(signals, tier) };
  });
  const zones: ZonesFile = {
    version: 1,
    critical: files
      .filter((f) => f.tier === 'critical')
      .map((f) => ({ path: f.file, reason: f.reason })),
    shared: files
      .filter((f) => f.tier === 'shared')
      .map((f) => ({ path: f.file, reason: f.reason })),
  };
  return { files, zones };
}

export interface SparkOptions {
  chat: ChatFn;
  model: string;
  topN?: number;
  cacheDir?: string;
}

export interface TaggedScanResult extends ScanResult {
  tagged: number;
  cacheHits: number;
}

export function sparkReasonSuffix(tag: SparkTag): string {
  return `spark tags ${tag.handles.join('+')} (${tag.confidence}): ${tag.reason}`;
}

export async function scanRepoWithTags(
  repoRoot: string,
  baseOptions: ScanOptions = {},
  spark: SparkOptions,
): Promise<TaggedScanResult> {
  const { files } = scanRepo(repoRoot, baseOptions);
  const cache = fileTagCache(spark.cacheDir ?? join(resolve(repoRoot), ZONING_DIR, CACHE_DIR));
  const candidates = selectTagCandidates(files, spark.topN ?? DEFAULT_THRESHOLDS.sparkTopN);
  let cacheHits = 0;
  for (const f of candidates) {
    const content = readFileSync(join(resolve(repoRoot), f.file), 'utf8');
    const { tag, cached } = await tagFile(f.file, content, {
      chat: spark.chat,
      model: spark.model,
      cache,
    });
    if (cached) cacheHits += 1;
    f.tag = tag;
    f.reason = `${f.reason}; ${sparkReasonSuffix(tag)}`;
    if (f.tier === 'shared' && tagUpgradesToCritical(tag)) {
      f.tier = 'critical';
    }
  }
  const zones: ZonesFile = {
    version: 1,
    critical: files
      .filter((f) => f.tier === 'critical')
      .map((f) => ({ path: f.file, reason: f.reason })),
    shared: files
      .filter((f) => f.tier === 'shared')
      .map((f) => ({ path: f.file, reason: f.reason })),
  };
  return { files, zones, tagged: candidates.length, cacheHits };
}

export const SUGGESTED_FILENAME = 'zones.suggested.yml';
export const ZONES_FILENAME = 'zones.yml';

export function writeSuggestedZones(repoRoot: string, zones: ZonesFile): string {
  const parsed = ZonesFileSchema.parse(zones);
  const text = `# Suggested zones. Copy entries into ${ZONES_FILENAME} after review.\n# Zoning never writes ${ZONES_FILENAME} itself.\n${stringify(parsed)}`;
  const outPath = join(repoRoot, SUGGESTED_FILENAME);
  writeFileSync(outPath, text, 'utf8');
  return outPath;
}

export function loadZonesFile(repoRoot: string, filename: string = ZONES_FILENAME): ZonesFile | undefined {
  try {
    const text = readFileSync(join(repoRoot, filename), 'utf8');
    return ZonesFileSchema.parse(parse(text));
  } catch {
    return undefined;
  }
}
