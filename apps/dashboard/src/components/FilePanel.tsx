import type { JSX } from 'react';
import type { BlastResponse } from '../api';

export function FilePanel({ blast }: { blast: BlastResponse | null }): JSX.Element {
  return (
    <section aria-label="File panel">
      <h2>File</h2>
      {blast === null && <p className="empty">Select a file in the zone map.</p>}
      {blast !== null && (
        <div>
          <p className="filename">{blast.file}</p>
          <p>
            <span className={`badge ${blast.tier}`}>{blast.tier}</span>
            {blast.reason !== undefined && <span className="reason"> — {blast.reason}</span>}
          </p>
          {blast.tag !== undefined && (
            <p className="tag">
              <strong>Spark</strong> tags {blast.tag.handles.join(', ')} ({blast.tag.confidence}):{' '}
              {blast.tag.reason}
            </p>
          )}
          <h3>Imported by ({blast.importers.length})</h3>
          {blast.importers.length === 0 && <p className="empty">Nothing imports this file.</p>}
          {blast.importers.length > 0 && (
            <ul className="mono-list">
              {blast.importers.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
