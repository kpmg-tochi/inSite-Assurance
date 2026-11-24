/**
 * Redesign R5a: change notifications for the visit data on the phone. Stores and the sync emit a topic
 * after every write; screens subscribe (or use `useVisitData`) and re-read from SQLite. No data is
 * carried in the event: SQLite is the single source the screens read.
 */
export type VisitDataTopic = 'visits' | 'forms' | 'fieldPacks' | 'drafts' | 'siteLog' | 'packs' | 'captures';

type Listener = (topic: VisitDataTopic) => void;
const listeners = new Set<Listener>();

export function emitVisitDataChanged(topic: VisitDataTopic): void {
  for (const l of listeners) {
    try {
      l(topic);
    } catch {
      // A screen's listener must never break a store write.
    }
  }
}

/** Calls `listener` after each change; returns the unsubscribe function. */
export function subscribeVisitData(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
