import { installHook } from './hook.js';
import type { ChatFn } from './llm.js';
import {
  scanRepo,
  scanRepoWithTags,
  writeSuggestedZones,
  type ScannedFile,
} from './scan.js';
import type { ZonesFile } from './schemas.js';
import { writeSkill } from './skill.js';

export interface InitSpark {
  chat: ChatFn;
  model: string;
  topN?: number;
}

export interface InitOptions {
  spark?: InitSpark;
  cliEntryAbs: string;
  includeHotfixes?: boolean;
}

export interface InitResult {
  suggestedPath: string;
  counts: { critical: number; shared: number; open: number };
  tagged?: { tagged: number; cacheHits: number };
  hookPath: string;
  hookCreated: boolean;
  skillPath: string;
  skillCreated: boolean;
}

export async function runInit(repoRoot: string, opts: InitOptions): Promise<InitResult> {
  const baseOptions = { includeHotfixes: opts.includeHotfixes };
  let files: ScannedFile[];
  let zones: ZonesFile;
  let tagged: { tagged: number; cacheHits: number } | undefined;
  if (opts.spark === undefined) {
    ({ files, zones } = scanRepo(repoRoot, baseOptions));
  } else {
    const result = await scanRepoWithTags(repoRoot, baseOptions, {
      chat: opts.spark.chat,
      model: opts.spark.model,
      topN: opts.spark.topN,
    });
    files = result.files;
    zones = result.zones;
    tagged = { tagged: result.tagged, cacheHits: result.cacheHits };
  }
  const suggestedPath = writeSuggestedZones(repoRoot, zones);
  const counts = {
    critical: files.filter((f) => f.tier === 'critical').length,
    shared: files.filter((f) => f.tier === 'shared').length,
    open: files.filter((f) => f.tier === 'open').length,
  };
  const hook = installHook(repoRoot, opts.cliEntryAbs);
  const skill = writeSkill(repoRoot);
  return {
    suggestedPath,
    counts,
    ...(tagged !== undefined ? { tagged } : {}),
    hookPath: hook.path,
    hookCreated: hook.created,
    skillPath: skill.path,
    skillCreated: skill.created,
  };
}
