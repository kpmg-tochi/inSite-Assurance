import * as Location from 'expo-location';
import type { HeadingReading } from '@insite/shared';
import { HEADING_WAIT_MS, HeadingTracker, isSettledHeading } from '../utils/headingReadings';

/**
 * Compass heading (UBEC IRL, 2026-11-25) through expo-location's heading subscription. True north
 * when the OS gives it (it needs location permission and a fix for the declination), else magnetic;
 * the reading says which. Never blocks capture: no compass, no permission or no reading within
 * HEADING_WAIT_MS gives null.
 *
 * expo-location on Android keeps one native heading watch at a time (a second `watchHeadingAsync`
 * takes it over, and removing either stops it), so every caller shares one subscription here,
 * reference-counted. The camera holds it while it is on screen (`startHeadingWatch`), so the reading
 * at the shutter is immediate; `readHeading` joins it for a short wait.
 */

type Listener = (reading: HeadingReading) => void;

interface SharedWatch {
  tracker: HeadingTracker;
  sub: Location.LocationSubscription | null;
  users: number;
  listeners: Set<Listener>;
}

let shared: SharedWatch | null = null;

/** Starts (or joins) the shared compass subscription; call the returned function to leave it. */
export function startHeadingWatch(): () => void {
  if (!shared) {
    const state: SharedWatch = { tracker: new HeadingTracker(), sub: null, users: 0, listeners: new Set() };
    shared = state;
    Location.watchHeadingAsync((h) => {
      const reading = state.tracker.push(h, Date.now());
      if (reading) state.listeners.forEach((l) => l(reading));
    })
      .then((sub) => {
        if (shared === state && state.users > 0) state.sub = sub;
        else sub.remove();
      })
      .catch(() => undefined);
  }
  const state = shared;
  state.users += 1;
  let left = false;
  return () => {
    if (left) return;
    left = true;
    state.users -= 1;
    if (state.users <= 0) {
      state.sub?.remove();
      if (shared === state) shared = null;
    }
  };
}

/**
 * A heading now: the open subscription's newest reading when it is settled (the OS reports only
 * changes, so it is current however old), else a short wait for a settled one (the best seen when
 * the wait ends), else null.
 */
export async function readHeading(timeoutMs: number = HEADING_WAIT_MS): Promise<HeadingReading | null> {
  const leave = startHeadingWatch();
  const state = shared!;
  const current = state.tracker.latest(Date.now());
  if (current && isSettledHeading(current)) {
    leave();
    return current;
  }
  const seen = new HeadingTracker();
  if (current) seen.record(current, Date.now());
  return new Promise<HeadingReading | null>((resolve) => {
    let done = false;
    const listener: Listener = (reading) => {
      seen.record(reading, Date.now());
      if (isSettledHeading(reading)) finish(reading);
    };
    const finish = (value: HeadingReading | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      state.listeners.delete(listener);
      leave();
      resolve(value);
    };
    const timer = setTimeout(() => finish(seen.best()), timeoutMs);
    state.listeners.add(listener);
  });
}
