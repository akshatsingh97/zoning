import type { JSX } from 'react';
import type { WatchEvent } from '../api';

function label(type: WatchEvent['type']): string {
  switch (type) {
    case 'drive_by':
      return 'DRIVE-BY';
    case 'in_scope_change':
      return 'in scope';
    case 'shared_change':
      return 'shared';
    case 'open_change':
      return 'open';
  }
}

function timeOf(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toLocaleTimeString();
}

export function LiveFeed({ events, live }: { events: WatchEvent[]; live: boolean }): JSX.Element {
  return (
    <section aria-label="Live feed">
      <h2>
        Live feed{' '}
        <span className={live ? 'live-dot on' : 'live-dot off'} title={live ? 'live' : 'reconnecting'}>
          {live ? 'live' : 'reconnecting'}
        </span>
      </h2>
      {events.length === 0 && <p>Waiting for edits — run zoning watch in another terminal.</p>}
      <ol className="feed">
        {events.map((e, i) => (
          <li key={`${e.at}-${e.file}-${i}`} className={`event ${e.type}`}>
            <span className="event-type">{label(e.type)}</span>{' '}
            <span className="event-file">{e.file}</span>{' '}
            <span className="event-time">{timeOf(e.at)}</span>
            {e.type === 'drive_by' && e.reason !== undefined && (
              <span className="event-reason"> — {e.reason}</span>
            )}
            {e.type === 'shared_change' && e.importers !== undefined && (
              <span className="event-reason"> — {e.importers.length} importers</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
