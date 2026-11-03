import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key === '') continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadDotEnv(dir: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): void {
  let text: string;
  try {
    text = readFileSync(join(dir, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const [key, value] of Object.entries(parseDotEnv(text))) {
    if (env[key] === undefined) env[key] = value;
  }
}
