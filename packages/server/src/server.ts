import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildImportGraph,
  CHECKS_DIR,
  contentHash,
  fileTagCache,
  findCacheKey,
  loadZonesFile,
  readActiveContract,
  readGapQuestions,
  readStoredCheck,
  resolveZone,
  TAG_PROMPT_VERSION,
  WatchEventSchema,
  ZONING_DIR,
  type SparkTag,
  type StoredCheck,
  type WatchEvent,
  type ZonesFile,
} from '@zoning/core';
import { createEventHub, type EventHub } from './hub.js';

const IGNORE_DIRS = new Set(['node_modules', '.git', '.zoning', 'dist', 'build', 'coverage']);

export function listRepoFiles(repoRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (IGNORE_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(resolve(repoRoot));
  return out
    .map((f) => relative(resolve(repoRoot), f).split(sep).join('/'))
    .filter((f) => f !== '' && !f.startsWith('..'))
    .sort();
}

export interface ZoneRow {
  file: string;
  tier: 'critical' | 'shared' | 'open';
  reason?: string;
  tag?: SparkTag;
}

function cachedTag(cacheDir: string, content: string): SparkTag | undefined {
  const key = findCacheKey(cacheDir, TAG_PROMPT_VERSION, contentHash(content));
  return key === undefined ? undefined : fileTagCache(cacheDir).read(key);
}

function readText(file: string): string | undefined {
  try {
    if (statSync(file).size > 200_000) return undefined;
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

export interface ServerOptions {
  staticDir?: string;
}

export interface BuiltServer {
  app: FastifyInstance;
  hub: EventHub;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

function serveFile(reply: FastifyReply, file: string): void {
  reply.header('content-type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
  reply.send(readFileSync(file));
}

export function buildServer(repoRoot: string, opts: ServerOptions = {}): BuiltServer {
  const root = resolve(repoRoot);
  const app = Fastify({ logger: false });
  const hub = createEventHub();
  const cacheDir = join(root, ZONING_DIR, 'cache');

  const zonesFile = (): ZonesFile =>
    loadZonesFile(root) ?? { version: 1, critical: [], shared: [] };

  app.addHook('onRequest', (_req, reply, done) => {
    reply.header('access-control-allow-origin', '*');
    done();
  });

  app.get('/zones', () => {
    const zones = zonesFile();
    const files: ZoneRow[] = listRepoFiles(root).map((file) => {
      const zone = resolveZone(zones, file);
      const content = readText(join(root, file));
      const tag = content === undefined ? undefined : cachedTag(cacheDir, content);
      return {
        file,
        tier: zone.tier,
        ...(zone.reason !== undefined ? { reason: zone.reason } : {}),
        ...(tag !== undefined ? { tag } : {}),
      };
    });
    return {
      files,
      counts: {
        critical: files.filter((f) => f.tier === 'critical').length,
        shared: files.filter((f) => f.tier === 'shared').length,
        open: files.filter((f) => f.tier === 'open').length,
      },
    };
  });

  app.get('/blast-radius', (req, reply) => {
    const query = req.query as { file?: unknown };
    const file = typeof query.file === 'string' ? query.file.replace(/^\.\/+/g, '') : '';
    if (file === '') return reply.code(400).send({ error: 'missing ?file=' });
    const abs = join(root, file);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      return reply.code(404).send({ error: `no such file: ${file}` });
    }
    const zone = resolveZone(zonesFile(), file);
    const importers = buildImportGraph(root).importersOf.get(file) ?? [];
    const content = readText(abs);
    const tag = content === undefined ? undefined : cachedTag(cacheDir, content);
    return {
      file,
      tier: zone.tier,
      ...(zone.reason !== undefined ? { reason: zone.reason } : {}),
      ...(tag !== undefined ? { tag } : {}),
      importers,
    };
  });

  app.get('/events', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    reply.raw.write('retry: 3000\n\n');
    for (const event of hub.recent()) {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    const send = (event: WatchEvent): void => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const unsub = hub.subscribe(send);
    const beat = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, 20000);
    req.raw.on('close', () => {
      clearInterval(beat);
      unsub();
    });
  });

  app.post('/events', (req, reply) => {
    const parsed = WatchEventSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid event' });
    hub.publish(parsed.data);
    return { ok: true };
  });

  app.get('/checks', () => {
    const checksDir = join(root, ZONING_DIR, CHECKS_DIR);
    let entries: string[];
    try {
      entries = readdirSync(checksDir);
    } catch {
      return { checks: [] };
    }
    const checks: StoredCheck[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const stored = readStoredCheck(checksDir, entry.slice(0, -'.json'.length));
      if (stored !== undefined) checks.push(stored);
    }
    checks.sort((a, b) => (a.at < b.at ? 1 : -1));
    return { checks };
  });

  app.get('/contract', () => {
    const active = readActiveContract(root);
    if (active === undefined) return { active: null, gapQuestions: [] as string[] };
    return {
      active: { slug: active.slug, contract: active.contract },
      gapQuestions: readGapQuestions(root, active.slug) ?? [],
    };
  });

  const staticDir = opts.staticDir;
  if (staticDir !== undefined) {
    const dist = resolve(staticDir);
    app.get('/', (_req, reply) => {
      const index = join(dist, 'index.html');
      if (!existsSync(index)) {
        return reply.send('Dashboard not built — run pnpm build in the zoning repo.');
      }
      serveFile(reply, index);
    });
    app.get('/*', (req, reply) => {
      const rel = (req.params as { '*': string })['*'] ?? '';
      const file = resolve(dist, rel);
      if (file !== dist && !file.startsWith(dist + sep)) {
        return reply.code(404).send('not found');
      }
      if (existsSync(file) && statSync(file).isFile()) {
        serveFile(reply, file);
        return;
      }
      if (extname(file) === '') {
        const index = join(dist, 'index.html');
        if (existsSync(index)) {
          serveFile(reply, index);
          return;
        }
      }
      return reply.code(404).send('not found');
    });
  }

  return { app, hub };
}

export function defaultStaticDir(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'apps',
    'dashboard',
    'dist',
  );
}

export async function startServer(
  repoRoot: string,
  port: number,
  opts: ServerOptions = {},
): Promise<{ url: string; close: () => Promise<void> }> {
  const { app } = buildServer(repoRoot, {
    staticDir: opts.staticDir ?? defaultStaticDir(),
  });
  await app.listen({ port, host: '127.0.0.1' });
  return { url: `http://127.0.0.1:${port}`, close: () => app.close() };
}
