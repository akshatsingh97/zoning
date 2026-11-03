import { describe, expect, it } from 'vitest';
import { createEventHub } from '../src/hub';
import type { WatchEvent } from '@zoning/core';

function event(file: string): WatchEvent {
  return { type: 'open_change', file, tier: 'open', at: 't' };
}

describe('createEventHub', () => {
  it('broadcasts to subscribers and replays recent events', () => {
    const hub = createEventHub();
    const seen: WatchEvent[] = [];
    const unsub = hub.subscribe((e) => seen.push(e));
    hub.publish(event('a.ts'));
    hub.publish(event('b.ts'));
    expect(seen.map((e) => e.file)).toEqual(['a.ts', 'b.ts']);
    expect(hub.recent().map((e) => e.file)).toEqual(['a.ts', 'b.ts']);
    unsub();
    hub.publish(event('c.ts'));
    expect(seen).toHaveLength(2);
    expect(hub.recent()).toHaveLength(3);
  });

  it('caps the replay buffer', () => {
    const hub = createEventHub(2);
    hub.publish(event('a.ts'));
    hub.publish(event('b.ts'));
    hub.publish(event('c.ts'));
    expect(hub.recent().map((e) => e.file)).toEqual(['b.ts', 'c.ts']);
  });
});
