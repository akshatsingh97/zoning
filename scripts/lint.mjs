// Lightweight repo lint for M1 (stdlib only, no extra deps).
// Checks:
// 1. .env is not tracked by git.
// 2. All relative imports in packages/*/src use explicit .js extensions (NodeNext ESM).
// 3. No model SDK imports outside packages/core/src/llm.ts (reserved for M2).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const repo = (p) => join(ROOT, p);

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`lint: ${msg}`);
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

// 1. .env must not be tracked.
try {
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  if (tracked.split('\n').some((f) => f === '.env' || (f.startsWith('.env.') && f !== '.env.example'))) {
    fail('.env file is tracked by git (secrets must stay untracked)');
  }
} catch {
  fail('could not run git ls-files to verify .env is untracked');
}

// 2 + 3. Import rules.
const srcFiles = [...walk(repo('packages'))];
const relImport = /(?:import|export)\s[^'"]*from\s+['"](\.[^'"]*)['"]/g;
for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  for (const match of text.matchAll(relImport)) {
    const spec = match[1];
    if (!spec.endsWith('.js') && !spec.endsWith('.json')) {
      fail(`${rel}: relative import '${spec}' needs an explicit .js extension`);
    }
  }
  if (rel !== 'packages/core/src/llm.ts' && /from\s+['"]openai['"]/.test(text)) {
    fail(`${rel}: model SDK imports are only allowed in packages/core/src/llm.ts`);
  }
}

if (failures > 0) {
  console.error(`lint: ${failures} problem(s)`);
  process.exit(1);
}
console.log('lint: ok');
