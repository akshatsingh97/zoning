import chokidar from 'chokidar';
import { realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { readActiveContract } from './contracts.js';
import { classifyChange, sendEventToServer } from './events.js';
import type { WatchEvent } from './schemas.js';
import { buildImportGraph, toPosix } from './importGraph.js';
import { loadZonesFile } from './scan.js';
import { resolveZone } from './zones.js';

export interface WatchOptions {
  onEvent: (event: WatchEvent) => void;
  onError?: (err: Error) => void;
  serverUrl?: string;
  usePolling?: boolean;
  pollIntervalMs?: number;
}

export interface WatchHandle {
  ready(): Promise<void>;
  stop(): Promise<void>;
}

const IGNORED_DIRS = new Set(['node_modules', '.git', '.zoning']);

export function isIgnoredPath(root: string, absPath: string): boolean {
  const rel = toPosix(relative(root, absPath));
  if (rel === '' || rel.startsWith('..')) return false;
  return rel.split('/').some((seg) => IGNORED_DIRS.has(seg));
}

export async function watchRepo(repoRoot: string, opts: WatchOptions): Promise<WatchHandle> {
  const root = realpathSync(resolve(repoRoot));
  const zones = loadZonesFile(root);
  if (zones === undefined) {
    throw new Error(
      `no zones.yml in ${root} — run "zoning scan" and copy zones.suggested.yml to zones.yml first`,
    );
  }
  const watcher = chokidar.watch(root, {
    ignored: (absPath: string) => isIgnoredPath(root, absPath),
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 50 },
    usePolling: opts.usePolling ?? false,
    interval: opts.pollIntervalMs ?? 300,
  });

  const handle = async (absPath: string): Promise<void> => {
    try {
      if (isIgnoredPath(root, absPath)) return;
      const file = toPosix(relative(root, absPath));
      if (file === '' || file.startsWith('..')) return;
      const zone = resolveZone(zones, file);
      const active = readActiveContract(root);
      const type = classifyChange(
        zone.tier,
        file,
        active === undefined ? undefined : { slug: active.slug, contract: active.contract },
      );
      let importers: string[] | undefined;
      if (type === 'shared_change') {
        importers = buildImportGraph(root).importersOf.get(file) ?? [];
      }
      const event: WatchEvent = {
        type,
        file,
        tier: zone.tier,
        ...(zone.reason !== undefined ? { reason: zone.reason } : {}),
        ...(importers !== undefined ? { importers } : {}),
        ...(active !== undefined ? { contractSlug: active.slug } : {}),
        at: new Date().toISOString(),
      };
      opts.onEvent(event);
      if (opts.serverUrl !== undefined) {
        await sendEventToServer(opts.serverUrl, event);
      }
    } catch (err) {
      opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  watcher.on('add', (p) => void handle(p));
  watcher.on('change', (p) => void handle(p));
  watcher.on('unlink', (p) => void handle(p));
  watcher.on('error', (err) =>
    opts.onError?.(err instanceof Error ? err : new Error(String(err))),
  );

  let resolveReady: () => void = () => {};
  const readyPromise = new Promise<void>((resolveReadyFn) => {
    resolveReady = resolveReadyFn;
  });
  watcher.on('ready', () => resolveReady());

  return {
    ready: () => readyPromise,
    stop: () => watcher.close().then(() => undefined),
  };
}
