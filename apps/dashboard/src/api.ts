export type Tier = 'critical' | 'shared' | 'open';
export type EventType = 'drive_by' | 'in_scope_change' | 'shared_change' | 'open_change';

export interface SparkTag {
  handles: string[];
  confidence: 'low' | 'medium' | 'high';
  reason: string;
}

export interface ZoneRow {
  file: string;
  tier: Tier;
  reason?: string;
  tag?: SparkTag;
}

export interface ZonesResponse {
  files: ZoneRow[];
  counts: { critical: number; shared: number; open: number };
}

export interface BlastResponse {
  file: string;
  tier: Tier;
  reason?: string;
  tag?: SparkTag;
  importers: string[];
}

export interface WatchEvent {
  type: EventType;
  file: string;
  tier: Tier;
  reason?: string;
  importers?: string[];
  contractSlug?: string;
  at: string;
}

export interface Contract {
  task: string;
  in_scope: string[];
  must_change: string[];
  must_not_change: string[];
}

export interface ContractResponse {
  active: { slug: string; contract: Contract } | null;
  gapQuestions: string[];
}

export interface CheckViolation {
  rule: string;
  file: string;
  line: number;
  explanation: string;
}

export interface StoredCheck {
  key: string;
  slug: string;
  result: { verdict: 'pass' | 'fail'; violations: CheckViolation[]; out_of_scope: string[] };
  at: string;
}

export interface ChecksResponse {
  checks: StoredCheck[];
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

export const getZones = (): Promise<ZonesResponse> => getJson('/zones');
export const getBlast = (file: string): Promise<BlastResponse> =>
  getJson(`/blast-radius?file=${encodeURIComponent(file)}`);
export const getContract = (): Promise<ContractResponse> => getJson('/contract');
export const getChecks = (): Promise<ChecksResponse> => getJson('/checks');

export function subscribeEvents(
  onEvent: (event: WatchEvent) => void,
  onStatus: (live: boolean) => void,
): () => void {
  const src = new EventSource('/events');
  src.onopen = () => onStatus(true);
  src.onerror = () => onStatus(false);
  src.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as WatchEvent);
    } catch {
      // Ignore malformed frames; the stream continues.
    }
  };
  return () => src.close();
}
