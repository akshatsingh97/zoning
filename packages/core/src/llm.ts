import { type ZodType } from 'zod';
import OpenAI from 'openai';

export const SPARK_BASE_URL = 'https://api.meta.ai/v1';
export const DEFAULT_MODEL = 'muse-spark-1.3';

export interface LlmConfig {
  apiKey: string;
  model: string;
  baseURL: string;
}

export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig | undefined {
  const apiKey = env.MODEL_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) return undefined;
  return {
    apiKey,
    model: env.ZONING_MODEL ?? DEFAULT_MODEL,
    baseURL: SPARK_BASE_URL,
  };
}

export type ChatFn = (system: string, user: string) => Promise<string>;

export interface SparkClient {
  chat: ChatFn;
  model: string;
}

export function sparkFromEnv(env: NodeJS.ProcessEnv = process.env): SparkClient | undefined {
  const config = llmConfigFromEnv(env);
  if (config === undefined) return undefined;
  return { chat: createChatFn(config), model: config.model };
}

export function createChatFn(config: LlmConfig): ChatFn {
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  return async (system: string, user: string): Promise<string> => {
    const res = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    });
    return res.choices[0]?.message?.content ?? '';
  };
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const withoutFence = trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '');
    return withoutFence.trim();
  }
  return trimmed;
}

function truncate(text: string, max = 200): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

export function parseJsonWithSchema<T>(text: string, schema: ZodType<T>): T {
  let data: unknown;
  try {
    data = JSON.parse(extractJson(text));
  } catch {
    throw new Error(`model did not return valid JSON: ${truncate(text)}`);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`model response failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function completeJson<T>(
  chat: ChatFn,
  system: string,
  user: string,
  schema: ZodType<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await chat(system, user);
      return parseJsonWithSchema(text, schema);
    } catch (err) {
      lastError = err;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`model call failed after 1 retry: ${detail}`);
}
