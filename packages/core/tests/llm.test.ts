import { describe, expect, it, vi } from 'vitest';
import {
  completeJson,
  DEFAULT_MODEL,
  llmConfigFromEnv,
  parseJsonWithSchema,
  SPARK_BASE_URL,
  sparkFromEnv,
} from '../src/llm';
import { SparkTagSchema } from '../src/schemas';

const VALID_TAG = JSON.stringify({ handles: ['money'], confidence: 'high', reason: 'charges cards' });

describe('llmConfigFromEnv', () => {
  it('returns undefined without an API key', () => {
    expect(llmConfigFromEnv({})).toBeUndefined();
    expect(llmConfigFromEnv({ MODEL_API_KEY: '' })).toBeUndefined();
  });

  it('defaults the model and pins the Meta base URL', () => {
    const config = llmConfigFromEnv({ MODEL_API_KEY: 'k' });
    expect(config).toEqual({ apiKey: 'k', model: DEFAULT_MODEL, baseURL: SPARK_BASE_URL });
  });

  it('respects ZONING_MODEL', () => {
    expect(llmConfigFromEnv({ MODEL_API_KEY: 'k', ZONING_MODEL: 'other' })?.model).toBe('other');
  });
});

describe('sparkFromEnv', () => {
  it('returns undefined without a key', () => {
    expect(sparkFromEnv({})).toBeUndefined();
  });

  it('builds chat and model with a key', () => {
    const spark = sparkFromEnv({ MODEL_API_KEY: 'k', ZONING_MODEL: 'm' });
    expect(spark?.model).toBe('m');
    expect(typeof spark?.chat).toBe('function');
  });
});

describe('parseJsonWithSchema', () => {
  it('accepts valid tag JSON', () => {
    expect(parseJsonWithSchema(VALID_TAG, SparkTagSchema)).toEqual({
      handles: ['money'],
      confidence: 'high',
      reason: 'charges cards',
    });
  });

  it('accepts fenced JSON', () => {
    expect(parseJsonWithSchema(`\`\`\`json\n${VALID_TAG}\n\`\`\``, SparkTagSchema).confidence).toBe('high');
  });

  it('throws a clear error for invalid JSON', () => {
    expect(() => parseJsonWithSchema('not json', SparkTagSchema)).toThrow(
      'model did not return valid JSON',
    );
  });

  it('throws a clear error when the schema does not match', () => {
    expect(() =>
      parseJsonWithSchema(JSON.stringify({ handles: ['gold'], confidence: 'high' }), SparkTagSchema),
    ).toThrow('model response failed validation');
  });
});

describe('completeJson', () => {
  it('returns data after a single call on success', async () => {
    const chat = vi.fn(async () => VALID_TAG);
    const tag = await completeJson(chat, 'sys', 'user', SparkTagSchema);
    expect(tag.confidence).toBe('high');
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('retries once after a bad response, then succeeds', async () => {
    const chat = vi.fn(async () => VALID_TAG).mockRejectedValueOnce(new Error('boom'));
    const tag = await completeJson(chat, 'sys', 'user', SparkTagSchema);
    expect(tag.handles).toEqual(['money']);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('fails clearly after 1 retry', async () => {
    const chat = vi.fn(async () => 'garbage');
    await expect(completeJson(chat, 'sys', 'user', SparkTagSchema)).rejects.toThrow(
      'model call failed after 1 retry',
    );
    expect(chat).toHaveBeenCalledTimes(2);
  });
});
