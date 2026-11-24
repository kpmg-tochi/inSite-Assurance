import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeVisitData, type VisitDataTopic } from '../storage/visitEvents';
import { subscribeToVisitSync, type VisitSyncSnapshot, getVisitSyncSnapshot } from '../services/visitSync';
import { subscribeToSyncStatus, getSyncStatusSnapshot, type SyncStatusSnapshot } from '../storage/outbox/outboxProcessor';

/**
 * Redesign R5a: how screens read visit data. `useVisitData(loader, deps, topics)` runs `loader`
 * (any async read from visitStore / siteLogStore / baselineStore) on mount, when `deps` change and
 * after every store write on one of `topics` (all topics by default). SQLite is the only source.
 *
 *   const { data, loading, error, reload } = useVisitData(() => listVisits({ from, to }), [from, to], ['visits', 'drafts']);
 */
export function useVisitData<T>(
  loader: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
  topics?: VisitDataTopic[]
): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const seq = useRef(0);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    loaderRef
      .current()
      .then((value) => {
        if (mine !== seq.current) return;
        setData(value);
        setError(null);
      })
      .catch((e: unknown) => {
        if (mine !== seq.current) return;
        setError((e as Error)?.message ?? 'Could not read local data.');
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const topicKey = (topics ?? []).join(',');
  useEffect(() => {
    const wanted = topicKey ? new Set(topicKey.split(',')) : null;
    return subscribeVisitData((topic) => {
      if (!wanted || wanted.has(topic)) reload();
    });
  }, [topicKey, reload]);

  return { data, loading, error, reload };
}

/** The visit download status (syncing, last synced, last error, cached window). */
export function useVisitSyncStatus(): VisitSyncSnapshot {
  const [s, setS] = useState<VisitSyncSnapshot>(getVisitSyncSnapshot());
  useEffect(() => subscribeToVisitSync(setS), []);
  return s;
}

/** The outbox status (online, pending and dead-lettered counts) for the header badge. */
export function useOutboxStatus(): SyncStatusSnapshot {
  const [s, setS] = useState<SyncStatusSnapshot>(getSyncStatusSnapshot());
  useEffect(() => subscribeToSyncStatus(setS), []);
  return s;
}
