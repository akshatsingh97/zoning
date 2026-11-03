import type { WatchEvent } from '@zoning/core';

export interface EventHub {
  publish(event: WatchEvent): void;
  recent(): WatchEvent[];
  subscribe(send: (event: WatchEvent) => void): () => void;
}

export function createEventHub(limit = 100): EventHub {
  const buffer: WatchEvent[] = [];
  const subs = new Set<(event: WatchEvent) => void>();
  return {
    publish(event: WatchEvent): void {
      buffer.push(event);
      if (buffer.length > limit) buffer.splice(0, buffer.length - limit);
      for (const send of subs) {
        try {
          send(event);
        } catch {
          // Subscriber is gone; it unsubscribes on close.
        }
      }
    },
    recent(): WatchEvent[] {
      return [...buffer];
    },
    subscribe(send: (event: WatchEvent) => void): () => void {
      subs.add(send);
      return () => {
        subs.delete(send);
      };
    },
  };
}
