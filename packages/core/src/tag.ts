import { completeJson, type ChatFn } from './llm.js';
import { contentHash, fileJsonCache, type JsonCache } from './cache.js';
import { SparkTagSchema, type SparkTag } from './schemas.js';

export const TAG_PROMPT_VERSION = 'tag-v1';
export const SNIPPET_CHARS = 4000;

export function cacheKeyFor(model: string, content: string): string {
  return `${TAG_PROMPT_VERSION}-${model}-${contentHash(content)}`;
}

export type TagCache = JsonCache<SparkTag>;

export function fileTagCache(cacheDir: string): TagCache {
  return fileJsonCache(cacheDir, SparkTagSchema);
}

export function fileSnippet(content: string, maxChars: number = SNIPPET_CHARS): string {
  return content.length > maxChars ? content.slice(0, maxChars) : content;
}

export const TAG_SYSTEM = [
  'You classify source files by what they handle.',
  'Reply with JSON only: {"handles": [...], "confidence": "low|medium|high", "reason": "..."}.',
  'handles uses only these values: money, personal_data, permissions, infra, none.',
  'Use "none" only when nothing else applies. "money" means the file moves, charges, refunds or records money.',
].join(' ');

export function tagPromptFor(file: string, snippet: string): string {
  return `File: ${file}\n\nFirst part of the file:\n${snippet}`;
}

export interface TagDeps {
  chat: ChatFn;
  model: string;
  cache: TagCache;
}

export async function tagFile(
  file: string,
  content: string,
  deps: TagDeps,
): Promise<{ tag: SparkTag; cached: boolean }> {
  const key = cacheKeyFor(deps.model, content);
  const hit = deps.cache.read(key);
  if (hit !== undefined) return { tag: hit, cached: true };
  const tag = await completeJson(
    deps.chat,
    TAG_SYSTEM,
    tagPromptFor(file, fileSnippet(content)),
    SparkTagSchema,
  );
  deps.cache.write(key, tag);
  return { tag, cached: false };
}

export interface TagCandidate {
  file: string;
  tier: 'critical' | 'shared' | 'open';
  fanIn: number;
  hotfixes: number;
}

export function selectTagCandidates<T extends TagCandidate>(files: T[], topN: number): T[] {
  if (topN <= 0) return [];
  return files
    .filter((f) => f.tier === 'critical' || f.tier === 'shared')
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier === 'critical' ? -1 : 1;
      if (a.fanIn !== b.fanIn) return b.fanIn - a.fanIn;
      if (a.hotfixes !== b.hotfixes) return b.hotfixes - a.hotfixes;
      return a.file < b.file ? -1 : 1;
    })
    .slice(0, topN);
}

export function tagUpgradesToCritical(tag: SparkTag): boolean {
  return (
    tag.confidence === 'high' && tag.handles.some((h) => h === 'money' || h === 'permissions')
  );
}
