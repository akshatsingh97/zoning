import { readActiveContract } from './contracts.js';
import type { ZoneTier } from './config.js';
import { loadZonesFile } from './scan.js';
import type { ZonesFile } from './schemas.js';

export interface ResolvedZone {
  tier: ZoneTier;
  reason?: string;
  pattern?: string;
}

function normalize(p: string): string {
  return p
    .trim()
    .replace(/^\.\/+/g, '')
    .replace(/\\/g, '/');
}

const REGEX_SPECIAL = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);

function segmentMatches(patternSeg: string, seg: string): boolean {
  let src = '';
  for (const ch of patternSeg) {
    if (ch === '*') src += '.*';
    else if (ch === '?') src += '.';
    else if (REGEX_SPECIAL.has(ch)) src += `\\${ch}`;
    else src += ch;
  }
  return new RegExp(`^${src}$`).test(seg);
}

function matchSegments(pats: string[], segs: string[]): boolean {
  if (pats.length === 0) return segs.length === 0;
  const [head, ...rest] = pats as [string, ...string[]];
  if (head === '**') {
    for (let i = 0; i <= segs.length; i++) {
      if (matchSegments(rest, segs.slice(i))) return true;
    }
    return false;
  }
  if (segs.length === 0) return false;
  const [segHead, ...segRest] = segs as [string, ...string[]];
  if (!segmentMatches(head, segHead)) return false;
  return matchSegments(rest, segRest);
}

export function matchZonePattern(pattern: string, file: string): boolean {
  return matchSegments(normalize(pattern).split('/'), normalize(file).split('/'));
}

export function resolveZone(zones: ZonesFile, file: string): ResolvedZone {
  for (const entry of zones.critical) {
    if (matchZonePattern(entry.path, file)) {
      return { tier: 'critical', reason: entry.reason, pattern: entry.path };
    }
  }
  for (const entry of zones.shared) {
    if (matchZonePattern(entry.path, file)) {
      return { tier: 'shared', reason: entry.reason, pattern: entry.path };
    }
  }
  return { tier: 'open' };
}

export interface ZoneDescription {
  file: string;
  tier: ZoneTier;
  reason?: string;
  contractSlug?: string;
  inScope: boolean;
}

export function describeZone(repoRoot: string, file: string): ZoneDescription {
  const zones = loadZonesFile(repoRoot);
  if (zones === undefined) {
    throw new Error(
      `no zones.yml in ${repoRoot} — run "zoning scan" and copy zones.suggested.yml to zones.yml first`,
    );
  }
  const stored = file.replace(/^\.\/+/g, '');
  const zone = resolveZone(zones, stored);
  const active = readActiveContract(repoRoot);
  const inScope = active !== undefined && active.contract.in_scope.includes(stored);
  return {
    file: stored,
    tier: zone.tier,
    ...(zone.reason !== undefined ? { reason: zone.reason } : {}),
    ...(active !== undefined ? { contractSlug: active.slug } : {}),
    inScope,
  };
}
