import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import {
  getBlast,
  getChecks,
  getContract,
  getZones,
  subscribeEvents,
  type BlastResponse,
  type ChecksResponse,
  type ContractResponse,
  type WatchEvent,
  type ZonesResponse,
} from './api';
import { ContractPanel } from './components/ContractPanel';
import { FilePanel } from './components/FilePanel';
import { LiveFeed } from './components/LiveFeed';
import { ZoneMap } from './components/ZoneMap';
import './App.css';

export function App(): JSX.Element {
  const [zones, setZones] = useState<ZonesResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [blast, setBlast] = useState<BlastResponse | null>(null);
  const [events, setEvents] = useState<WatchEvent[]>([]);
  const [live, setLive] = useState(false);
  const [contract, setContract] = useState<ContractResponse | null>(null);
  const [checks, setChecks] = useState<ChecksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [z, c, k] = await Promise.all([getZones(), getContract(), getChecks()]);
      setZones(z);
      setContract(c);
      setChecks(k);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeEvents(
      (event) => {
        setEvents((prev) => [event, ...prev].slice(0, 50));
        void refresh();
      },
      (ok) => setLive(ok),
    );
  }, [refresh]);

  useEffect(() => {
    if (selected === null) {
      setBlast(null);
      return;
    }
    let cancelled = false;
    getBlast(selected)
      .then((b) => {
        if (!cancelled) setBlast(b);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  return (
    <div className="app">
      <header>
        <div className="brand">
          <div className="logo" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="brand-text">
            <h1>Zoning</h1>
            <span className="tagline">zoning laws for AI in your codebase</span>
          </div>
        </div>
        <div className="header-actions">
          <span
            className={live ? 'live-dot on' : 'live-dot off'}
            title={live ? 'connected to watcher stream' : 'reconnecting'}
          >
            {live ? 'live' : 'reconnecting'}
          </span>
          <button type="button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </header>
      {error !== null && <p className="error">Failed to load: {error}</p>}
      <main>
        <div className="column">
          {zones !== null && <ZoneMap zones={zones} selected={selected} onSelect={setSelected} />}
        </div>
        <div className="column">
          <FilePanel blast={blast} />
          {contract !== null && checks !== null && (
            <ContractPanel contract={contract} checks={checks} />
          )}
        </div>
        <div className="column">
          <LiveFeed events={events} />
        </div>
      </main>
    </div>
  );
}
