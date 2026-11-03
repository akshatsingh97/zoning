import type { ZoneTier } from './config.js';
import type { Contract, WatchEvent } from './schemas.js';

export type WatchEventType = WatchEvent['type'];

export interface ActiveScope {
  slug: string;
  contract: Contract;
}

export function classifyChange(
  tier: ZoneTier,
  file: string,
  active: ActiveScope | undefined,
): WatchEventType {
  if (tier === 'critical') {
    if (active !== undefined && active.contract.in_scope.includes(file)) return 'in_scope_change';
    return 'drive_by';
  }
  if (tier === 'shared') return 'shared_change';
  return 'open_change';
}

export function formatEvent(event: WatchEvent): string {
  switch (event.type) {
    case 'drive_by': {
      const reason = event.reason ?? 'no reason recorded';
      const scope =
        event.contractSlug === undefined
          ? 'There is no active contract.'
          : `It is not in the active contract (${event.contractSlug}).`;
      return [
        '!!! DRIVE-BY EDIT !!!',
        `${event.file} is Critical (${reason}). ${scope}`,
      ].join('\n');
    }
    case 'in_scope_change': {
      const slug = event.contractSlug === undefined ? '' : `, contract ${event.contractSlug}`;
      return `in-scope change: ${event.file} (Critical${slug})`;
    }
    case 'shared_change': {
      const importers = event.importers ?? [];
      const who =
        importers.length === 0
          ? 'nothing imports it right now'
          : `imported by ${importers.length}: ${importers.join(', ')}`;
      return `shared change: ${event.file} — ${who}`;
    }
    case 'open_change':
      return `open change: ${event.file}`;
  }
}

export async function sendEventToServer(
  serverUrl: string,
  event: WatchEvent,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`${serverUrl.replace(/\/+$/, '')}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
