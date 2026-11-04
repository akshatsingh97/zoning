import type { JSX } from 'react';
import type { ZoneRow, ZonesResponse } from '../api';

function folderOf(file: string): string {
  const i = file.lastIndexOf('/');
  return i === -1 ? '(root)' : file.slice(0, i);
}

export function ZoneMap({
  zones,
  selected,
  onSelect,
}: {
  zones: ZonesResponse;
  selected: string | null;
  onSelect: (file: string) => void;
}): JSX.Element {
  const groups = new Map<string, ZoneRow[]>();
  for (const row of zones.files) {
    const folder = folderOf(row.file);
    const list = groups.get(folder) ?? [];
    list.push(row);
    groups.set(folder, list);
  }
  return (
    <section aria-label="Zone map">
      <h2>Zone map</h2>
      <p className="counts">
        <span className="badge critical">{zones.counts.critical} critical</span>
        <span className="badge shared">{zones.counts.shared} shared</span>
        <span className="badge open">{zones.counts.open} open</span>
      </p>
      {zones.files.length === 0 && <p className="empty">No files found. Is zones.yml set up?</p>}
      {[...groups.entries()].map(([folder, rows]) => (
        <div key={folder} className="folder">
          <h3>{folder}</h3>
          <ul>
            {rows.map((row) => (
              <li key={row.file}>
                <button
                  type="button"
                  className={`file tier-${row.tier}${selected === row.file ? ' selected' : ''}`}
                  onClick={() => onSelect(row.file)}
                  title={row.reason ?? row.tier}
                >
                  <span className="dot" aria-hidden="true" />
                  {row.file.slice(folder === '(root)' ? 0 : folder.length + 1)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
