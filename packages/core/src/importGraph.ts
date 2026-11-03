import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const IGNORE_DIRS = new Set(['node_modules', '.git', '.zoning', 'dist', 'build', 'coverage']);

const IMPORT_RE =
  /(?:import\s+(?:[^'"]*?\sfrom\s+)?|export\s+(?:[^'"]*?\sfrom\s+)?|require\s*\()\s*['"]([^'"]+)['"]/g;

export function toPosix(p: string): string {
  return p.split('\\').join('/');
}

export function listSourceFiles(repoRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (IGNORE_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (SOURCE_EXTENSIONS.has(extOf(entry))) {
        out.push(toPosix(relative(repoRoot, full)));
      }
    }
  };
  walk(resolve(repoRoot));
  return out.sort();
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

export function parseImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  IMPORT_RE.lastIndex = 0;
  for (let m = IMPORT_RE.exec(source); m !== null; m = IMPORT_RE.exec(source)) {
    specs.push(m[1]);
  }
  return specs;
}

const EXT_CANDIDATES = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function stripJsExt(spec: string): string {
  return spec.replace(/\.(js|mjs|cjs)$/, '');
}

export function resolveRelativeImport(fromFile: string, spec: string, files: Set<string>): string | undefined {
  if (!spec.startsWith('.')) return undefined;
  const base = stripJsExt(join(dirname(fromFile), spec));
  const normalized = toPosix(base);
  for (const ext of EXT_CANDIDATES) {
    const candidate = `${normalized}${ext}`;
    if (files.has(candidate)) return candidate;
    for (const index of ['index.ts', 'index.js', 'index.tsx']) {
      const idx = `${normalized}${ext}/${index}`;
      if (files.has(idx)) return idx;
    }
  }
  return undefined;
}

export interface ImportGraph {
  files: string[];
  importersOf: Map<string, string[]>;
}

export function buildImportGraph(repoRoot: string, files?: string[]): ImportGraph {
  const list = files ?? listSourceFiles(repoRoot);
  const set = new Set(list);
  const importersOf = new Map<string, string[]>();
  for (const f of list) importersOf.set(f, []);
  for (const f of list) {
    const source = readFileSync(join(resolve(repoRoot), f), 'utf8');
    const seen = new Set<string>();
    for (const spec of parseImportSpecifiers(source)) {
      const target = resolveRelativeImport(f, spec, set);
      if (target !== undefined && target !== f && !seen.has(target)) {
        seen.add(target);
        importersOf.get(target)?.push(f);
      }
    }
  }
  for (const v of importersOf.values()) v.sort();
  return { files: [...list].sort(), importersOf };
}

export function fanIn(graph: ImportGraph, file: string): number {
  return graph.importersOf.get(file)?.length ?? 0;
}
