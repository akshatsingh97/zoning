import { stringify } from 'yaml';
import { contentHash, fileJsonCache, type JsonCache } from './cache.js';
import { completeJson, type ChatFn } from './llm.js';
import { GapQuestionsSchema, type Contract } from './schemas.js';

export const GAPS_PROMPT_VERSION = 'gaps-v1';
export const MAX_GAP_QUESTIONS = 3;
export const GAP_FILE_CHARS = 12000;

export const GAPS_SYSTEM = [
  'You review intent contracts for risky code changes.',
  'Read the contract and the in-scope files, then ask about important rules the contract seems to be missing,',
  'such as failure modes, timeouts, retries, idempotency, or backwards compatibility.',
  'Reply with JSON only: {"questions": [...]}.',
  'At most 3 short questions. If the contract already covers everything important, reply with an empty array.',
  'Never rewrite the contract; only ask questions.',
].join(' ');

export interface InScopeFile {
  file: string;
  content: string;
}

export function gapsPromptFor(contract: Contract, files: InScopeFile[]): string {
  const parts = [`Intent contract:\n${stringify(contract).trimEnd()}`];
  for (const f of files) {
    const body =
      f.content.length > GAP_FILE_CHARS
        ? `${f.content.slice(0, GAP_FILE_CHARS)}\n[... truncated ...]`
        : f.content;
    parts.push(`File: ${f.file}\n${body}`);
  }
  return parts.join('\n\n---\n\n');
}

export function gapsInputHash(contract: Contract, files: InScopeFile[]): string {
  const input = `${stringify(contract)}\n${files.map((f) => `File: ${f.file}\n${f.content}`).join('\n')}`;
  return contentHash(input);
}

export function gapsCacheKeyFor(model: string, contract: Contract, files: InScopeFile[]): string {
  return `${GAPS_PROMPT_VERSION}-${model}-${gapsInputHash(contract, files)}`;
}

export type GapsCache = JsonCache<{ questions: string[] }>;

export function fileGapsCache(cacheDir: string): GapsCache {
  return fileJsonCache(cacheDir, GapQuestionsSchema);
}

export function cleanQuestions(questions: string[]): string[] {
  return questions
    .map((q) => q.trim())
    .filter((q) => q !== '')
    .slice(0, MAX_GAP_QUESTIONS);
}

export async function requestGapQuestions(
  chat: ChatFn,
  model: string,
  cache: GapsCache,
  contract: Contract,
  files: InScopeFile[],
): Promise<{ questions: string[]; cached: boolean }> {
  const key = gapsCacheKeyFor(model, contract, files);
  const hit = cache.read(key);
  if (hit !== undefined) return { questions: cleanQuestions(hit.questions), cached: true };
  const result = await completeJson(
    chat,
    GAPS_SYSTEM,
    gapsPromptFor(contract, files),
    GapQuestionsSchema,
  );
  cache.write(key, result);
  return { questions: cleanQuestions(result.questions), cached: false };
}
